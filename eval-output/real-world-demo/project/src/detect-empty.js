const PLACEHOLDER_PATTERNS = [
  /^\s*tbd\s*$/i,
  /^\s*todo\s*$/i,
  /^\s*\[insert\s+.+?\s+here\]\s*$/i,
  /^\s*n\/?a\s*$/i,
];

const ATTACHMENT_PATTERNS = [
  /\b(attached|attachment|attach)\b/i,
  /\bsee attached\b/i,
  /\buse the attached\b/i,
];

const BARE_SPEC_PATTERNS = [
  /^(write|create|make|draft|generate)\s+(a\s+)?spec(ification)?$/i,
  /^(write|create|make|draft|generate)\s+(a\s+)?spec(ification)?\s*[.!?]?\s*$/i,
];

const CONTEXT_REFERENCE_PATTERNS = [
  /^same as (above|before|previous)$/i,
  /^see (above|previous|prior)$/i,
  /^as (above|before|mentioned)$/i,
];

const REQUEST_MARKER = /^(.*?user'?s?\s+request\s*:\s*)(.*)/is;

/**
 * Detects whether a specification request is empty, partial, or references
 * an inaccessible attachment.
 *
 * @param {string} input - The user's raw input
 * @returns {{ isEmpty: boolean, isPartial?: boolean, missingFields?: string[], hasInaccessibleAttachment?: boolean, reason?: string }}
 */
export function detectEmpty(input) {
  const trimmed = input.trim();

  // Completely empty or whitespace-only
  if (trimmed === '') {
    return { isEmpty: true, reason: 'The request is empty.' };
  }

  // Punctuation-only
  if (/^[\s\p{P}]+$/u.test(trimmed)) {
    return { isEmpty: true, reason: 'The request contains only punctuation.' };
  }

  // Check for request marker pattern like "User's request: <content>"
  const markerMatch = trimmed.match(REQUEST_MARKER);
  if (markerMatch) {
    const content = markerMatch[2].trim();
    if (content === '') {
      return { isEmpty: true, reason: 'The request appears to be empty — no content follows the request marker.' };
    }
    if (isPlaceholder(content)) {
      return { isEmpty: true, reason: 'The request contains only placeholder text.' };
    }
    // Check for partial template in the content after marker
    const partial = detectPartialTemplate(content);
    if (partial) return partial;

    // Content after marker is substantive
    return buildNonEmpty(content);
  }

  // Context references with no prior context
  if (CONTEXT_REFERENCE_PATTERNS.some(p => p.test(trimmed))) {
    return {
      isEmpty: true,
      reason: 'References prior context that is not available. Please restate your request.',
    };
  }

  // Bare "write a spec" with no subject
  if (BARE_SPEC_PATTERNS.some(p => p.test(trimmed))) {
    return { isEmpty: true, reason: 'The request asks for a specification but does not identify what the specification is for.' };
  }

  // Placeholder-only input
  if (isPlaceholder(trimmed)) {
    return { isEmpty: true, reason: 'The request contains only placeholder text.' };
  }

  // Check for partial template
  const partial = detectPartialTemplate(trimmed);
  if (partial) return partial;

  // Check for inaccessible attachment references
  const hasAttachment = ATTACHMENT_PATTERNS.some(p => p.test(trimmed));
  if (hasAttachment) {
    // If there's also a substantive subject beyond the attachment ref, still flag attachment
    return {
      isEmpty: false,
      isPartial: false,
      hasInaccessibleAttachment: true,
    };
  }

  // Non-empty request
  return { isEmpty: false, isPartial: false, hasInaccessibleAttachment: false };
}

function isPlaceholder(text) {
  return PLACEHOLDER_PATTERNS.some(p => p.test(text));
}

/**
 * Detects a partially filled template where some key:value fields are present
 * but some values are missing.
 */
function detectPartialTemplate(text) {
  // Match "Key: value" patterns — a field is "filled" if there's text after the colon
  const fieldPattern = /([A-Za-z][\w\s]*?):\s*(.*?)(?=;|$)/g;
  const fields = [];
  let match;

  while ((match = fieldPattern.exec(text)) !== null) {
    const key = match[1].trim();
    const value = match[2].trim();
    fields.push({ key, value });
  }

  if (fields.length === 0) return null;

  const filledFields = fields.filter(f => f.value.length > 0 && !isPlaceholder(f.value));
  const emptyFields = fields.filter(f => f.value.length === 0 || isPlaceholder(f.value));

  // Only partial if at least one field is filled and at least one is empty
  if (filledFields.length > 0 && emptyFields.length > 0) {
    return {
      isEmpty: false,
      isPartial: true,
      missingFields: emptyFields.map(f => f.key),
      hasInaccessibleAttachment: false,
    };
  }

  return null;
}

function buildNonEmpty(content) {
  const hasAttachment = ATTACHMENT_PATTERNS.some(p => p.test(content));
  return {
    isEmpty: false,
    isPartial: false,
    hasInaccessibleAttachment: hasAttachment,
  };
}
