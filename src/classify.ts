import { stripIndent, oneLine } from 'common-tags';
import { chromium } from 'playwright';
import { Message } from './messages';
import { generateWithConsensus, generate } from './generate';
import { gzipBase64ToBuffer } from './util';

const system = stripIndent`
  Classify the email into one of these categories:

  1. Promotional: Marketing emails like newsletters or event invites, generally not personalized.
  2. Transactional: Automated responses to actions, like order confirmations or account updates, with specific details.
  3. Personal: Direct messages from individuals that often require a response, such as personal notes, direct requests, or important information from contacts.

  Be cautious of emails that may appear to belong to one category but are actually another, such as promotional emails mimicking personal ones.

  Read the email and state the category with a short reason for your choice.
`;

async function getTextFromHtml(html: string) {
  const browser = await chromium.launch();

  let page;
  try {
    page = await browser.newPage();
    await page.goto(
      `data:text/html;charset=utf-8;base64,${Buffer.from(html).toString('base64')}`,
      { waitUntil: 'domcontentloaded' },
    );

    return await page.evaluate(() => document.documentElement.innerText);
  } catch (cause) {
    throw new Error('Could not get text from HTML', { cause });
  } finally {
    await page?.close();
    await browser.close();
  }
}

function removeLinksFromText(text: string) {
  return text.replace(
    /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/gi,
    '',
  );
}

async function getEmailContent({ id, body }: Message) {
  const plainText = body.find((content) => content.mimeType === 'text/plain');
  if (plainText)
    return (await gzipBase64ToBuffer(plainText.compressedBody)).toString(
      'utf-8',
    );

  const htmlBody = body.find((content) => content.mimeType === 'text/html');
  if (htmlBody)
    return await getTextFromHtml(
      (await gzipBase64ToBuffer(htmlBody.compressedBody)).toString('utf-8'),
    );

  throw new Error(`Could not parse email message for message ${id}`);
}

const categories = ['promotional', 'transactional', 'personal'] as const;
export type Classification = (typeof categories)[number];

export async function classify<TMessage extends Message>(message: TMessage) {
  console.log(`Classifying message '${message.id}'…`);

  const { body, mimeType, ...metadata } = message;
  const formattedMetadata = Object.entries(metadata)
    .filter(([_key, value]) => !!value)
    .map(([key, value]) => `- **${key}**: ${value}`)
    .join('\n');

  const content = removeLinksFromText(await getEmailContent(message));
  const prompt = `# ${metadata.subject} — ${metadata.snippet}\n\n${formattedMetadata}\n\n${content}`;

  const classification = await generateWithConsensus({
    model: 'mistral',
    system,
    prompt,
    parser: (content) =>
      generate({
        model: 'mistral',
        system: oneLine`
          Parse the following message for a category classification. Only output
          either \`promotional\`, \`transactional\`, or \`personal\`.
        `,
        prompt: content,
        parser: (parsed) => {
          const parsedNormalized = parsed.toLowerCase();
          const category = categories.find((category) => {
            const otherCategories = categories.filter(
              (otherCategory) => category !== otherCategory,
            );

            return (
              parsedNormalized.includes(category) &&
              otherCategories.every(
                (otherCategory) => !parsedNormalized.includes(otherCategory),
              )
            );
          });
          if (!category) {
            throw new Error(`Failed to parse classification: \n${parsed}`);
          }
          return category;
        },
      }),
  });

  console.log(`Classified message ${message.id} as '${classification}'`);

  return classification;
}
