/**
 * The sample-mode banner (G2.2).
 *
 * Not a screen. It sits above whichever screen is on, for as long as the log is
 * fourteen weeks of a fictional athlete, and it exists because the one genuinely
 * bad outcome of sample data is somebody logging a real session into it and
 * discovering later that their training is mixed in with somebody else's.
 *
 * So it says what the log is in plain words and does not go away. There is no
 * dismiss: a banner that can be dismissed is a banner that will be, and the
 * fact it states stays true afterwards.
 *
 * The way out is a confirm, because wiping the database is unrecoverable and
 * this button is on screen constantly — which is exactly the one somebody
 * eventually presses by accident. The confirm says what is lost, and what is
 * lost is nothing anybody minds, which is the honest thing to say.
 */

export function SampleBanner({
  leaving,
  onAsk,
  onCancel,
  onConfirm,
}: {
  /** The confirm is up. */
  leaving: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (leaving) {
    return (
      <div className="banner sample asking">
        <p className="sample-ask">
          This clears the sample log and starts you over with the setup
          questions. Nothing of yours is in it.
        </p>
        <div className="sample-buttons">
          <button className="quiet" onClick={onCancel}>
            Keep looking
          </button>
          <button className="sample-go" onClick={onConfirm}>
            Clear it and start
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="banner sample">
      <span>
        <strong>Sample data.</strong> Fourteen weeks of a made-up athlete, so
        there is something to look at.
      </span>
      <span className="spacer" />
      <button onClick={onAsk}>Start real</button>
    </div>
  );
}
