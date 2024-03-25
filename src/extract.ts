import { stripIndent } from 'common-tags';
import { chromium } from 'playwright';
import prettier from 'prettier';
import { Message } from './messages';
import { generateWithConsensus } from './generate';
import { gzipBase64ToBuffer } from './util';

const system = stripIndent`
  **Task**: Identify the unsubscribe link in the email text.

  **Context**: Email text shows links as \`[link][index]\`, with \`<a href="">\` tags converted to this format. For example, "unsubscribe [here][0]".

  **Instructions**:
  1. Look for unsubscribe-related words (e.g., "unsubscribe," "opt-out").
  2. Identify the \`[text][index]\` for the unsubscribe action.
  3. Select the unsubscribe link's index, or return -1 if it's absent.

  **Note**: URLs are omitted; focus on text and context clues.

  **Output**: Provide the unsubscribe link's index, or -1 if not found.
`;

async function tryFormat(text: string) {
  try {
    return await prettier.format(text, { filepath: 'text.md' });
  } catch {
    return text;
  }
}

async function getLabeledAnchorsFromHtml(html: string) {
  const browser = await chromium.launch();

  let page;
  try {
    page = await browser.newPage();
    await page.goto(
      `data:text/html;charset=utf-8;base64,${Buffer.from(html).toString('base64')}`,
      { waitUntil: 'domcontentloaded' },
    );

    const { emailText, lookup } = await page.evaluate(() => {
      const anchors = Array.from(
        document.querySelectorAll<HTMLAnchorElement>('a[href]'),
      ).filter((a) => a.innerText.trim());
      let index = 0;

      const lookup: Record<string, string> = {};
      for (const anchor of anchors) {
        anchor.innerHTML = `[${anchor.innerText.trim()}][${index}]`;
        lookup[index.toString()] = anchor.href;
        index++;
      }

      return { emailText: document.documentElement.innerText, lookup };
    });

    return { emailText: await tryFormat(emailText), lookup };
  } catch (cause) {
    throw new Error('Could not get text from HTML', { cause });
  } finally {
    await page?.close();
    await browser.close();
  }
}

export async function extract(message: Message) {
  console.log(`Extracting unsubscribe link from message '${message.id}'…`);
  const { body, mimeType, ...metadata } = message;
  const formattedMetadata = Object.entries(metadata)
    .filter(([_key, value]) => !!value)
    .map(([key, value]) => `- **${key}**: ${value}`)
    .join('\n');

  const htmlBody = body.find((content) => content.mimeType === 'text/html');
  if (!htmlBody) {
    throw new Error('Could not get HTML from email body.');
  }
  const { emailText, lookup } = await getLabeledAnchorsFromHtml(
    (await gzipBase64ToBuffer(htmlBody.compressedBody)).toString('utf-8'),
  );

  const prompt = `# ${metadata.subject} — ${metadata.snippet}\n\n${formattedMetadata}\n\n${emailText}`;

  const linkIndex = await generateWithConsensus<number>({
    model: 'mistral',
    system,
    prompt,
    parser: (output) => {
      const match = /-?\d+/.exec(output.trim());
      if (!match) throw new Error(`Model did not return int:\n${output}`);
      return parseInt(match[0]);
    },
  });
  if (linkIndex === -1) throw new Error('Model did not find unsubscribe link.');

  if (!(linkIndex.toString() in lookup)) {
    throw new Error(`Labeled index not in lookup`);
  }

  const unsubscribeLink = lookup[linkIndex.toString()];
  console.log(
    `Extracted unsubscribe link from message ${message.id}.\n${unsubscribeLink}`,
  );
  return unsubscribeLink;
}
