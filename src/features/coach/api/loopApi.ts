import { api } from "../../../lib/apiClient";
import type { LoopFetch, Answer5 } from "../../../types/api";

export const loopApi = {
  getNext(sessionId: string) {
    return api.sessions.getNext(sessionId);
  },
  answer(sessionId: string, questionId: string, answer: Answer5) {
    return api.sessions.answer(sessionId, { questionId, answer });
  },
  undo(sessionId: string) {
    return api.sessions.undo(sessionId);
  },
  patch(
    sessionId: string,
    params: { threshold?: number; maxQuestions?: number }
  ) {
    return api.sessions.patchLoop(sessionId, params);
  },
};
