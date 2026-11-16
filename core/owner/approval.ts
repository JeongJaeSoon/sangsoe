import { unwrapPaste } from "./prompt.ts";

/**
 * Decision 311: the one line the owner types in the orchestrator's chat to approve a PR at a head that
 * only they may approve (V3, protected paths) on a one-account repo. The whole prompt is the line, and
 * the head is the full sha: a prefix can be ground by whoever pushes the next commit.
 */
const LINE = /^승인[ \t]+([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#([1-9][0-9]*)[ \t]+([0-9a-f]{40})$/;

/** The same shape anywhere in a text, in either case: what the gate refuses to let an agent put into a prompt. */
export const APPROVAL_SHAPE = /승인\s+[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#[0-9]+\s+[0-9a-fA-F]{40}/;

export type OwnerApprovalLine = { pr: string; head_sha: string };

/**
 * The approval a prompt is, or null. `pr` is land's key form, `owner/repo#N` lowercased. The line is
 * made to be copied, so a prompt that is one pasted block holding exactly the line is the line.
 */
export function parseApprovalLine(prompt: string): OwnerApprovalLine | null {
  const m = LINE.exec(unwrapPaste(prompt));
  if (!m) return null;
  return { pr: `${(m[1] as string).toLowerCase()}#${m[2]}`, head_sha: m[3] as string };
}

/** Whether `text` holds an approval line for `head`, as a scheduled prompt would carry it. */
export const carriesApproval = (text: string, head: string) => APPROVAL_SHAPE.test(text) && text.toLowerCase().includes(head);

/** The line to show the owner for `repo`#`pr` at `head`. */
export const approvalLine = (repo: string, pr: number, head: string) => `승인 ${repo}#${pr} ${head}`;
