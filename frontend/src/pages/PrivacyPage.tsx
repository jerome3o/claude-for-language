import { Link } from 'react-router-dom';
import './PrivacyPage.css';

/**
 * Public privacy policy (/privacy): no sign-in, no Header. Google Play asks for this URL
 * because the Lab Android app requests the microphone, camera and notifications
 * (android-lab/PLAY.md). Plain facts only — keep it in step with what the app stores.
 *
 * CONTACT_EMAIL: the app owner may put an address here; while it is empty the page just
 * says to contact the app owner (whoever invited you can pass a message on).
 */
const CONTACT_EMAIL = '';
const LAST_UPDATED = '30 September 2026';

export function PrivacyPage() {
  return (
    <main className="privacy-page">
      <article className="privacy-card">
        <header className="privacy-head">
          <span className="privacy-hanzi" aria-hidden="true">学</span>
          <h1>Privacy policy</h1>
          <p className="privacy-sub">
            Chinese Learning (web app, Android app and the “Lab” Android app) · Last updated {LAST_UPDATED}
          </p>
        </header>

        <p>
          This is a small, invite-only app for learning Chinese with a tutor. It is run by one person, the app
          owner. It has no ads, does not sell data and does not use your data to track you across other apps
          or websites.
        </p>

        <h2>What is stored</h2>
        <ul>
          <li>
            <strong>Your account</strong>: your name, email address and profile picture from Google
            sign-in, and anything you add to your profile (name, photo, “About me”, time zone).
          </li>
          <li>
            <strong>Study data</strong>: your decks and cards, every review you make (rating, time taken,
            typed answer), lessons, readers, homework and games, and study time per day.
          </li>
          <li>
            <strong>Recordings</strong>: when you record yourself saying a card or answering a lesson
            exercise (microphone), the recording and a text transcript of it.
          </li>
          <li>
            <strong>Video calls</strong>: calls with your tutor use the camera and microphone. The video goes
            directly between the two devices and is not stored. Each person’s microphone is recorded, and
            the app keeps those recordings, a transcript and a lesson summary written from it, the shared
            whiteboard and the call’s chat.
          </li>
          <li>
            <strong>Messages and questions</strong>: chat messages with your tutor, cards you flag for
            them, and the questions you ask Claude about your cards with the answers.
          </li>
          <li>
            <strong>Photos you upload</strong> (for example for a picture hunt), with location and other
            metadata removed.
          </li>
          <li>
            <strong>Device information</strong>: whether you use the web app or an Android app, how many
            audio clips are saved for offline use, sync state and occasional diagnostic reports, plus a
            notification token if you allow notifications.
          </li>
        </ul>

        <h2>How it is used</h2>
        <ul>
          <li>To run the app: schedule your reviews, sync between your devices and work offline.</li>
          <li>
            To share with your tutor: a tutor you are connected with can see your progress, reviews,
            recordings, flagged cards and questions, and writes notes and homework for you.
          </li>
          <li>
            To power features: text you send to AI features, and recordings to be transcribed, are processed
            by service providers — Anthropic (Claude), Google (sign-in, speech, Gemini), MiniMax (voices),
            Soniox (transcription) and Cloudflare (hosting, storage and speech recognition). They process it
            to provide the feature, not to advertise to you.
          </li>
          <li>Notifications only remind you about due cards, homework and calls. You can turn them off.</li>
        </ul>

        <h2>Permissions (Android)</h2>
        <ul>
          <li><strong>Microphone</strong>: recording yourself on a card or in a lesson, and video calls.</li>
          <li><strong>Camera</strong>: video calls only.</li>
          <li><strong>Notifications</strong>: due cards, homework and incoming calls.</li>
        </ul>
        <p>Android asks you before the app can use each one. You can say no and still use the rest of the app.</p>

        <h2>Keeping and deleting your data</h2>
        <p>
          Your data is kept while you have an account. You can delete your cards and decks in the app at any
          time. To delete your whole account and everything in it, ask the app owner; the
          account is deleted by the administrator. Copies of decks a tutor shared with a student belong to
          the student’s account.
        </p>

        <h2>Contact</h2>
        <p>
          {CONTACT_EMAIL
            ? <>Questions or a deletion request: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</>
            : <>For questions or a deletion request, contact the app owner (the tutor who invited you can
              pass your message on).</>}
        </p>

        <p className="privacy-back">
          <Link to="/">← Back to the app</Link>
        </p>
      </article>
    </main>
  );
}
