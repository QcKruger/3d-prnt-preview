import { useState } from "react";
import type { TrackingAccess } from "../tracking";
import { trackingUrl } from "../tracking";
export function TrackingLink({ access }: { access: TrackingAccess }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const url = trackingUrl(access);
  function download() {
    const blob = URL.createObjectURL(
      new Blob(
        [
          `3D PRNT — Private tracking link\n${url}\nExpires: ${new Date(access.expiresAt).toLocaleString()}\nAnyone with this link can view status. Keep it private. No email has been sent.\n`,
        ],
        { type: "text/plain;charset=utf-8" },
      ),
    );
    const a = document.createElement("a");
    a.href = blob;
    a.download = "3d-prnt-tracking-link.txt";
    a.click();
    setTimeout(() => URL.revokeObjectURL(blob), 1000);
  }
  return (
    <div className="tracking-link-card">
      <b>Keep your private tracking link</b>
      <p>
        Save this before leaving. Anyone with the link can view status. It
        expires {new Date(access.expiresAt).toLocaleString()}. No email has been
        sent.
      </p>
      <label
        className="sr-only"
        htmlFor={`tracking-link-${access.token.slice(0, 8)}`}
      >
        Private tracking link
      </label>
      <input
        id={`tracking-link-${access.token.slice(0, 8)}`}
        value={url}
        readOnly
        onFocus={(event) => event.target.select()}
      />
      <div className="return-actions">
        <button
          className="btn"
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              setCopied(true);
              setCopyError(false);
            } catch {
              setCopyError(true);
            }
          }}
        >
          {copied ? "LINK COPIED ✓" : "COPY TRACKING LINK"}
        </button>
        <button className="btn" type="button" onClick={download}>
          SAVE TRACKING LINK ↓
        </button>
      </div>
      {copyError && (
        <p role="status">
          Select and copy the link above, or save it as a file.
        </p>
      )}
    </div>
  );
}
