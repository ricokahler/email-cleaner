import { getMessageIds, getMessage } from './messages';
import { classify } from './classify';
import { extract } from './extract';
import { ensure, isProcessed } from './db';

for await (const id of getMessageIds()) {
  if (await isProcessed(id)) continue;

  let message;
  try {
    message = await ensure(id, 'message', () => getMessage(id));
  } catch (e) {
    console.warn(`Failed to download message ${id}`, e);
    console.log('\n');
    continue;
  }

  console.log(
    `Processing message '${id}'…\nFrom: ${message.from}\nSubject: ${message.subject}`,
  );

  let classification;
  try {
    classification = await ensure(id, 'classification', () =>
      classify(message),
    );
  } catch (e) {
    console.warn(`Failed to classify message ${id}`, e);
    console.log('\n');
    continue;
  }

  if (classification !== 'promotional') {
    console.log(`Message ${id} is non promotional. Skipping…\n\n`);
    continue;
  }

  try {
    await ensure(id, 'unsubscribeLink', () => extract(message));
  } catch (e) {
    console.warn(`Failed to extract link from message ${id}`, e);
    console.log('\n');
    continue;
  }

  console.log();
}
