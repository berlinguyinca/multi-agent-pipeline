const TEMPLATE = `Please describe what you want the specification for. A short version is enough, for example:

- Product or feature:
- Users:
- Main goal:
- Constraints or must-haves:`;

/**
 * Formats a response based on the detection result.
 *
 * @param {{ isEmpty: boolean, isPartial?: boolean, missingFields?: string[], hasInaccessibleAttachment?: boolean, reason?: string }} detection
 * @returns {string|null} The response text, or null if the request is complete.
 */
export function formatResponse(detection) {
  if (detection.isEmpty) {
    const restate = detection.reason && /restate|prior context/i.test(detection.reason);
    if (restate) {
      return `It looks like you're referencing prior context that isn't available. Please restate or repeat your request so I can help.\n\n${TEMPLATE}`;
    }
    return `It looks like the request is empty or missing the thing to specify.\n\n${TEMPLATE}`;
  }

  if (detection.hasInaccessibleAttachment) {
    return `I can't access attached documents or files directly. Could you paste or summarize the relevant content from the attachment so I can use it to write the specification?`;
  }

  if (detection.isPartial && detection.missingFields?.length > 0) {
    const fields = detection.missingFields.join(', ');
    return `I have some context to work with, but the following fields appear to be missing: ${fields}. Could you fill those in so I can proceed?`;
  }

  return null;
}
