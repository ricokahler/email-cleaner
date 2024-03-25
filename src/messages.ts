import { gmail } from './gmail';
import { type gmail_v1 } from 'googleapis';
import { bufferToGzipBase64 } from './util';

export type Message = Awaited<ReturnType<typeof getMessage>>;

export async function getMessage(id: string) {
  const { data } = await gmail.users.messages.get({ id, userId: 'me' });
  const { payload = {}, snippet } = data;

  const headers =
    payload.headers &&
    Object.fromEntries(
      payload.headers
        .filter(
          (entry): entry is typeof entry & { name: string; value: string } =>
            !!entry.name && !!entry.value,
        )
        .map(({ name, value }) => [name.trim().toLowerCase(), value]),
    );

  async function getBody(body: gmail_v1.Schema$MessagePartBody) {
    if (body.data) return Buffer.from(body.data, 'base64');

    if (body.attachmentId) {
      const attachment = await gmail.users.messages.attachments.get({
        userId: 'me',
        id: body.attachmentId,
      });

      return getBody(attachment.data);
    }

    throw new Error('Could not get body');
  }

  async function* getPayloads(
    payload: gmail_v1.Schema$MessagePart,
  ): AsyncGenerator<gmail_v1.Schema$MessagePart & { compressedBody: string }> {
    const { parts, body, ...restOfPayload } = payload;

    if (body?.data || body?.size || body?.attachmentId) {
      yield {
        ...restOfPayload,
        compressedBody: await bufferToGzipBase64(await getBody(body)),
      };
    }

    if (parts) {
      for (const part of parts) {
        yield* getPayloads(part);
      }
    }
  }

  const body: Array<gmail_v1.Schema$MessagePart & { compressedBody: string }> =
    [];
  for await (const part of getPayloads(payload)) {
    body.push(part);
  }

  console.log(`Downloaded message '${id}'.`);

  return {
    id,
    subject: headers?.subject,
    snippet,
    to: headers?.to,
    from: headers?.from,
    replyTo: headers?.['reply-to'],
    date: headers?.date,
    mimeType: payload.mimeType,
    body,
  };
}

export async function* getMessageIds(
  pageToken?: string,
): AsyncGenerator<string> {
  const userId = 'me';
  const { data } = await gmail.users.messages.list({ userId, pageToken });
  if (!data) throw new Error(`No data in message list result`);

  const { messages, nextPageToken } = data;
  if (!messages) return;

  for (const { id } of messages) {
    if (!id) continue;

    try {
      yield id;
    } catch (err) {
      if (err instanceof Error) {
        const message = `Could not get email '${id}': ${err.message}`;
        Object.assign(err, { message });
      }

      console.warn(err);
    }
  }

  if (nextPageToken) {
    yield* getMessageIds(nextPageToken);
  }
}
