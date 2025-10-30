import { api } from "../../../lib/apiClient";
import type { Answer5 } from "../../../types/api";

export const loopApi = {
  getNext(sessionId: string) {
    return api.sessions.getNext(sessionId);
  },
  answer(
    sessionId: string,
    params: { questionId: string; answer?: Answer5; answerText?: string }
  ) {
    return api.sessions.answer(sessionId, params);
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
