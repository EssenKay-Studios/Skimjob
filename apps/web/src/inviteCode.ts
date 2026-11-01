// Reading what a player types or pastes into "Join with invite code".
// The server decides what a real code is (M2-2); this only tidies the input
// and rejects what can't possibly be one, so typos fail before a request.

/** Codes are 4–16 letters or digits; case, spaces and dashes don't matter. */
const CODE = /^[a-z0-9]{4,16}$/;

/**
 * The invite code in `input`, lower-cased with spaces and dashes removed, or
 * null. A pasted invite link (`…/join/CODE` or `…/invite/CODE`) gives its code.
 */
export function parseInviteCode(input: string): string | null {
  let raw = input.trim();
  const link = raw.match(/\/(?:join|invite|invites|i)\/([^/?#\s]+)/i);
  if (link) raw = link[1]!;
  const code = raw.replace(/[\s-]+/g, "").toLowerCase();
  return CODE.test(code) ? code : null;
}
