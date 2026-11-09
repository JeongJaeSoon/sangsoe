/**
 * Where chat-monitor reads new mentions and replies. The public tree ships only the null
 * provider: an install that wires none gets no `mention_new`, and nothing reads chat in its place
 * (decision 45).
 */
export type ChatProvider = {
  readonly name: string;
  /** URLs of mentions and replies the provider has now; seen ones are dropped by dedupe_key. */
  mentions(signal: AbortSignal): Promise<{ url: string }[]>;
};

export const nullChatProvider: ChatProvider = {
  name: "null",
  mentions: async () => [],
};
