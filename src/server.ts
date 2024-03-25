import express from 'express';
import { html, safeHtml } from 'common-tags';
import { type Entry, db, set } from './db';
import { z } from 'zod';
import { gzipBase64ToBuffer } from './util';

const app = express();

function parseEmailAddress(email: string) {
  const emailRegex = /^(?:"?([^"]*)"?\s)?(?:<?(.+@[^>]+)>?)$/;
  const matches = email.match(emailRegex);

  if (!matches) return null;
  const [, name, address] = matches;

  return {
    name: name ? name.trim() : null,
    address: address.trim(),
  };
}

function formatEmailAddress(email: string | undefined) {
  if (!email) return '';

  const parsed = parseEmailAddress(email);
  if (!parsed) return '';

  const { address, name } = parsed;
  if (!name) return safeHtml`${address}`;
  return html`<span title="${safeHtml`${address}`}"
    >${safeHtml`${name}`}</span
  >`;
}

app.use(express.json());

app.use((_req, res, next) => {
  try {
    next();
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.issues });
    }
    throw error;
  }
});

const systemFontStack = `:root {
  font-family:
    -apple-system,
    BlinkMacSystemFont,
    avenir next,
    avenir,
    segoe ui,
    helvetica neue,
    helvetica,
    Cantarell,
    Ubuntu,
    roboto,
    noto,
    arial,
    sans-serif;
}`;

app.get('/:id', async (req, res) => {
  await db.read();
  const { id } = req.params;

  const entry = db.data.entries.find((entry) => entry.id === id);
  if (!entry) {
    res.sendStatus(404);
    return;
  }
  const { message, markedUnsubscribed = false } = entry;

  if (!message) {
    res.sendStatus(404);
    return;
  }

  let content = '';

  const htmlBody = message.body.find(
    (content) => content.mimeType === 'text/html',
  );
  const plainText = message.body.find(
    (content) => content.mimeType === 'text/plain',
  );
  if (htmlBody) {
    const html = (await gzipBase64ToBuffer(htmlBody.compressedBody)).toString(
      'utf-8',
    );

    content = html;
  } else if (plainText) {
    const text = (await gzipBase64ToBuffer(plainText.compressedBody)).toString(
      'utf-8',
    );

    content = html`<div>${text}</div>`;
  }

  res.send(html`
    <html>
      <head>
        <title>Email Cleaner: ${id}</title>
        <style>
          ${systemFontStack}
        </style>
      </head>
      <body>
        <fieldset>
          <legend>Mark as done?</legend>
          <label
            >Yes
            <input
              id="done"
              type="checkbox"
              ${markedUnsubscribed ? 'checked' : ''}
            />
          </label>
        </fieldset>

        <main>${content}</main>
        <script>
          document.querySelector('#done').addEventListener('change', (e) => {
            const markedUnsubscribed = e.currentTarget.checked;

            fetch('/${id}', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ markedUnsubscribed }),
            });
          });
        </script>
      </body>
    </html>
  `);
});

app.put('/:id', async (req, res) => {
  await db.read();
  const { id } = req.params;
  const entry = db.data.entries.find((entry) => entry.id === id);
  if (!entry) {
    res.sendStatus(404);
    return;
  }

  const { markedUnsubscribed } = z
    .object({ markedUnsubscribed: z.boolean() })
    .parse(req.body);

  await set(id, 'markedUnsubscribed', markedUnsubscribed);
  res.sendStatus(200);
});

app.get('/', async (req, res) => {
  await db.read();

  const hideDone = !!req.query.hidedone;
  const hideNonPromotional = !!req.query.hidenonpromo;

  res.send(html`
    <html>
      <head>
        <title>Email Cleaner</title>
        <style>
          ${systemFontStack};

          body {
            margin: 0;
          }

          main {
            width: 1024px;
            margin: 1rem auto;
            display: flex;
            flex-direction: column;
            gap: 1rem;
          }

          table {
            border-collapse: collapse;
          }

          th,
          td {
            text-align: left;
            padding: 0.5rem;
          }

          tr:nth-child(even) {
            background-color: #f2f2f2;
          }

          .header {
            position: sticky;
            top: 0;
            background: lightgray;
          }
        </style>
      </head>

      <body>
        <main>
          <h1>Email Cleaner</h1>
          <fieldset>
            <legend>Filters</legend>
            <label
              >Hide done
              <input
                class="hidedone"
                type="checkbox"
                ${hideDone ? 'checked' : ''}
            /></label>
            <label
              >Hide non-promotional
              <input
                class="hidenonpromo"
                type="checkbox"
                ${hideNonPromotional ? 'checked' : ''}
            /></label>
          </fieldset>

          <table>
            <thead>
              <tr class="header">
                <th>Subject</th>
                <th>From</th>
                <th>Classification</th>
                <th>Date</th>
                <th></th>
                <th></th>
                <th>Done?</th>
              </tr>
            </thead>
            <tbody>
              ${db.data.entries
                .filter(
                  (entry): entry is Entry & Required<Pick<Entry, 'message'>> =>
                    !!entry.message,
                )
                .filter((entry) =>
                  hideDone ? !entry.markedUnsubscribed : true,
                )
                .filter((entry) =>
                  hideNonPromotional
                    ? entry.classification === 'promotional'
                    : true,
                )
                .map(
                  ({
                    message,
                    id,
                    classification,
                    markedUnsubscribed,
                    unsubscribeLink,
                  }) => html`
                    <tr>
                      <td>${safeHtml`${message.subject}`}</td>
                      <td>${formatEmailAddress(message.from)}</td>
                      <td><code>${classification}</code></td>
                      <td>
                        ${message.date
                          ? new Date(message.date).toLocaleDateString()
                          : ''}
                      </td>
                      <td><a href="/${id}">Open</a></td>
                      <td>
                        ${unsubscribeLink
                          ? html`<a href="${unsubscribeLink}" target="_blank"
                              >Unsubscribe</a
                            >`
                          : ''}
                      </td>
                      <td>
                        <input
                          data-id=${id}
                          class="done"
                          type="checkbox"
                          ${markedUnsubscribed ? 'checked' : ''}
                        />
                      </td>
                    </tr>
                  `,
                )}
            </tbody>
          </table>
        </main>
      </body>
      <script>
        document.querySelector('.hidedone').addEventListener('change', (e) => {
          if (e.currentTarget.checked) {
            const params = new URLSearchParams(window.location.search);
            params.set('hidedone', 'true');
            window.location.href = '/?' + params;
          } else {
            const params = new URLSearchParams(window.location.search);
            params.delete('hidedone');
            window.location.href = '/?' + params;
          }
        });

        document
          .querySelector('.hidenonpromo')
          .addEventListener('change', (e) => {
            if (e.currentTarget.checked) {
              const params = new URLSearchParams(window.location.search);
              params.set('hidenonpromo', 'true');
              window.location.href = '/?' + params;
            } else {
              const params = new URLSearchParams(window.location.search);
              params.delete('hidenonpromo');
              window.location.href = '/?' + params;
            }
          });

        for (const el of document.querySelectorAll('.done')) {
          el.addEventListener('change', (e) => {
            const markedUnsubscribed = e.currentTarget.checked;
            const id = e.currentTarget.dataset.id;

            fetch('/' + id, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ markedUnsubscribed }),
            });
          });
        }
      </script>
    </html>
  `);
});

const server = app.listen(3000, () => {
  const address = server.address();
  if (!address) return;
  if (typeof address === 'string') return;

  console.log(`Up! http://localhost:${address.port}`);
});
