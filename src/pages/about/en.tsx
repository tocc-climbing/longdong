import type { AboutTextProps } from './types'

export default function AboutText({ projectUrl, sheetUrl }: AboutTextProps) {
  return (
    <>
      <p className="alert">
        This information is for reference only. Rock and anchors can change at any time — check conditions on site and climb at your own
        risk.
      </p>

      <h2>Offline use</h2>
      <p>
        After your first visit, the app and all route data are stored on your phone and work without a signal. On iPhone, add it to your
        home screen so the offline data isn’t cleared.
      </p>

      <h2>Account &amp; privacy</h2>
      <p>
        Sign in with Google. Your climb log is private; comments are public under your nickname; ratings are shown only as
        an average and count. Your email is never shown. Data is stored in TOCC’s Firebase project. Use “Report” on inappropriate comments
        and a moderator will review them. See the <a href="./terms.html">Terms of Service</a> and{' '}
        <a href="./privacy.html">Privacy Policy</a>. To delete your account and all data, open settings on the Me tab.
      </p>

      <h2>Data source</h2>
      <p>
        Route and bolt data are maintained by the{' '}
        <a href={projectUrl} target="_blank" rel="noreferrer">
          TOCC (Taiwan Outdoor Climbers’ Coalition) Rebolting Project
        </a>{' '}
        in a{' '}
        <a href={sheetUrl} target="_blank" rel="noreferrer">
          Google Sheet
        </a>
        , checked for updates daily and published after review. Please report errors to TOCC. Route descriptions and notes are in Chinese
        only.
      </p>
    </>
  )
}
