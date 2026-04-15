import { detectEmpty } from './detect-empty.js';
import { formatResponse } from './format-response.js';

/**
 * Handles a specification request. Returns a response string if the request
 * is empty, partial, or references an inaccessible attachment. Returns null
 * if the request is complete and the caller should proceed with specification work.
 *
 * @param {string} input - The user's raw input
 * @returns {string|null}
 */
export function handleRequest(input) {
  const detection = detectEmpty(input);
  return formatResponse(detection);
}

export { detectEmpty, formatResponse };
