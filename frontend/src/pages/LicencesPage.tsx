import { Link } from 'react-router-dom';
import './PrivacyPage.css';

/**
 * Public "About → Licences" (/about/licences; Settings → About): the open data the app is
 * built on and its licences. The character dictionary (scripts/build-char-dict.ts →
 * worker/char-dict/, served by GET /api/chars) is an adapted work of the three dictionary
 * sources below and is shared under the same terms.
 */
export function LicencesPage() {
  return (
    <main className="privacy-page">
      <article className="privacy-card">
        <header className="privacy-head">
          <span className="privacy-hanzi" aria-hidden="true">字</span>
          <h1>About &amp; licences</h1>
          <p className="privacy-sub">Open data and code this app is built on.</p>
        </header>

        <h2>Character dictionary</h2>
        <p>
          Tapping a character on a card shows dictionary data built from three open sources. The combined
          dataset is available under the same terms (CC BY-SA 4.0 for the word data, LGPL-3.0 for the
          character data); the script that builds it is <code>scripts/build-char-dict.ts</code> in the app’s source.
        </p>
        <ul>
          <li>
            <strong>CC-CEDICT</strong> — readings, words and English glosses. © MDBG and the CC-CEDICT
            contributors,{' '}
            <a href="https://www.mdbg.net/chinese/dictionary?page=cedict" target="_blank" rel="noreferrer">mdbg.net</a>,
            licensed{' '}
            <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">CC BY-SA 4.0</a>.
            Glosses are shortened and pinyin converted to tone marks.
          </li>
          <li>
            <strong>Make Me a Hanzi</strong> (<code>dictionary.txt</code>) — definitions, radicals,
            decompositions, etymology hints and stroke counts, derived from Unihan and CJKlib. ©
            Shaunak Kishore,{' '}
            <a href="https://github.com/skishore/makemeahanzi" target="_blank" rel="noreferrer">github.com/skishore/makemeahanzi</a>,
            licensed{' '}
            <a href="https://www.gnu.org/licenses/lgpl-3.0.html" target="_blank" rel="noreferrer">GNU LGPL 3.0</a>.
          </li>
          <li>
            <strong>wordfreq</strong> — word frequencies (word order and character frequency rank). ©
            Robyn Speer and contributors,{' '}
            <a href="https://github.com/rspeer/wordfreq" target="_blank" rel="noreferrer">github.com/rspeer/wordfreq</a>,
            data licensed{' '}
            <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">CC BY-SA 4.0</a>.
          </li>
        </ul>

        <h2>Handwriting</h2>
        <ul>
          <li>
            Stroke data: <a href="https://github.com/chanind/hanzi-writer-data" target="_blank" rel="noreferrer">hanzi-writer-data</a>{' '}
            from Make Me a Hanzi, derived from fonts by Arphic Technology —{' '}
            <a href="/strokes/ARPHICPL.TXT" target="_blank" rel="noreferrer">Arphic Public License</a>.
          </li>
          <li>
            Stroke checking adapted from <a href="https://github.com/chanind/hanzi-writer" target="_blank" rel="noreferrer">Hanzi Writer</a> (MIT).
          </li>
        </ul>

        <p className="privacy-back">
          <Link to="/privacy">Privacy policy</Link> · <Link to="/">Back to the app</Link>
        </p>
      </article>
    </main>
  );
}
