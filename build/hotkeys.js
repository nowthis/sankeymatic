/*
SankeyMATIC - hotkeys.js
Editor-style keyboard commands for the Diagram Inputs textarea.

Each command is a PURE transform:
  (text, selStart, selEnd) -> { text, selStart, selEnd }
No DOM access lives in the transforms, so they are unit-testable in node.
The thin DOM layer which binds them to keystrokes is at the bottom of
this file and only runs in a browser.
*/

(function skmHotkeys(glob) {
'use strict';

// 'glob' points to the global object, either 'window' (browser) or 'global'
// (node.js), matching the pattern used by sankeymatic.js.

// The marker inserted when commenting out lines. SankeyMATIC also accepts a
// leading apostrophe as a comment (see reCommentLine in constants.js), so we
// recognise both when UNcommenting but only ever insert '//'.
const commentInsert = '// ',
  reLineComment = /^(\s*)(\/\/ ?|' ?)/,
  // constants.js owns this marker, and is always loaded first in the browser.
  // It isn't loaded under node, so the tests fall back to a copy of its value:
  appliedSettingPrefix = typeof settingsAppliedPrefix === 'string'
    ? settingsAppliedPrefix
    : '// ✓ ';

/**
 * Character offset at which each line begins.
 * @param {string[]} lines
 * @returns {number[]}
 */
function lineOffsets(lines) {
  const offsets = [];
  let pos = 0;
  lines.forEach((l) => { offsets.push(pos); pos += l.length + 1; });
  return offsets;
}

/**
 * Index of the line containing a character offset.
 * @param {number[]} offsets
 * @param {number} pos
 * @returns {number}
 */
function lineIndexAt(offsets, pos) {
  for (let i = offsets.length - 1; i >= 0; i -= 1) {
    if (pos >= offsets[i]) { return i; }
  }
  return 0;
}

/**
 * A text's lines, plus the span of them which a selection touches. Every
 * command starts from this, so they all agree on what 'the selected lines'
 * means.
 * @param {string} text
 * @param {number} selStart
 * @param {number} selEnd
 * @returns {{lines: string[], offsets: number[], first: number, last: number}}
 */
function selectedLines(text, selStart, selEnd) {
  const lines = text.split('\n'),
    offsets = lineOffsets(lines);
  return {
    lines,
    offsets,
    first: lineIndexAt(offsets, selStart),
    last: lineIndexAt(offsets, selEnd),
  };
}

/**
 * Rewrite each fully-or-partly selected line, then shift the selection so it
 * still covers the same characters it did before.
 * @param {string} text
 * @param {number} selStart
 * @param {number} selEnd
 * @param {function} rewriteFn - (line, index) => new line
 * @param {object} [span] - a selectedLines() result, when the caller has one
 * @returns {{text: string, selStart: number, selEnd: number}}
 */
function perLine(text, selStart, selEnd, rewriteFn, span) {
  const { lines, offsets, first, last }
      = span ?? selectedLines(text, selStart, selEnd),
    // How much each rewritten line grew or shrank, and the running total for
    // the lines before it. Only selected lines can change, so both arrays are
    // indexed from 'first' rather than from the top of the text.
    deltas = [],
    shiftsBefore = [];
  let running = 0;

  for (let i = first; i <= last; i += 1) {
    const rewritten = rewriteFn(lines[i], i),
      delta = rewritten.length - lines[i].length;
    deltas.push(delta);
    shiftsBefore.push(running);
    running += delta;
    lines[i] = rewritten;
  }

  // Move a caret along with the text on its own line, clamped to that line.
  // A position already at column 0 stays there, so that a selection made by
  // dragging over whole lines still covers whole lines afterwards.
  // selStart and selEnd are by definition on lines 'first' and 'last', so a
  // position is always somewhere inside the rewritten block.
  function movedPos(pos) {
    const row = lineIndexAt(offsets, pos),
      inBlock = row - first,
      column = pos - offsets[row],
      newColumn = column === 0
        ? 0
        : clamp(column + deltas[inBlock], 0, lines[row].length);
    return offsets[row] + shiftsBefore[inBlock] + newColumn;
  }

  return {
    text: lines.join('\n'),
    selStart: movedPos(selStart),
    selEnd: movedPos(selEnd),
  };
}

/**
 * Keep a number inside a range.
 * @param {number} n
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(n, min, max) { return Math.min(Math.max(n, min), max); }

/**
 * True for lines process_sankey has marked as an applied setting.
 * Un-commenting one of these makes process_sankey apply the setting again and
 * then immediately re-comment the line, so the hotkey leaves them untouched.
 * @param {string} line
 * @returns {boolean}
 */
function isAppliedSetting(line) { return line.startsWith(appliedSettingPrefix); }

function isBlank(line) { return line.trim() === ''; }

/**
 * Toggle '//' comments on every selected line.
 * Follows the usual editor rule: if every eligible line is already a comment
 * the block is un-commented, otherwise the whole block is commented.
 * @param {string} text
 * @param {number} selStart
 * @param {number} selEnd
 * @returns {{text: string, selStart: number, selEnd: number}}
 */
function toggleComment(text, selStart, selEnd) {
  const span = selectedLines(text, selStart, selEnd),
    eligible = span.lines.slice(span.first, span.last + 1)
      .filter((l) => !isAppliedSetting(l) && !isBlank(l)),
    // With nothing eligible there is nothing to decide; 'uncomment' is a
    // no-op in that case either way.
    uncommenting = eligible.length > 0
      && eligible.every((l) => reLineComment.test(l));

  return perLine(text, selStart, selEnd, (line) => {
    if (isAppliedSetting(line)) { return line; }
    if (uncommenting) {
      const commented = line.match(reLineComment);
      if (!commented) { return line; }
      return line.slice(0, commented[1].length)
        + line.slice(commented[1].length + commented[2].length);
    }
    if (isBlank(line)) { return line; }
    const indent = line.match(/^(\s*)/)[1];
    return `${indent}${commentInsert}${line.slice(indent.length)}`;
  }, span);
}

/**
 * Move the selected line(s) up or down by one line, hopping over the
 * neighbouring line. A no-op at the top or bottom of the input.
 * @param {string} text
 * @param {number} selStart
 * @param {number} selEnd
 * @param {string} direction - 'up' or 'down'
 * @returns {{text: string, selStart: number, selEnd: number}}
 */
function moveLines(text, selStart, selEnd, direction) {
  const { lines, first, last } = selectedLines(text, selStart, selEnd),
    up = direction === 'up';

  if (up ? first === 0 : last === lines.length - 1) {
    return { text, selStart, selEnd };
  }

  const block = lines.slice(first, last + 1),
    neighbour = up ? lines[first - 1] : lines[last + 1],
    // The block slides past the neighbour, so it shifts by that line's
    // length plus its newline:
    shift = (neighbour.length + 1) * (up ? -1 : 1),
    reordered = up
      ? [...lines.slice(0, first - 1), ...block, neighbour,
        ...lines.slice(last + 1)]
      : [...lines.slice(0, first), neighbour, ...block,
        ...lines.slice(last + 2)];

  return {
    text: reordered.join('\n'),
    selStart: selStart + shift,
    selEnd: selEnd + shift,
  };
}

/**
 * Copy the selected line(s), placing the copy above or below the original.
 * The selection ends up on the new copy, so repeating the keystroke keeps
 * making further copies.
 * @param {string} text
 * @param {number} selStart
 * @param {number} selEnd
 * @param {string} direction - 'up' or 'down'
 * @returns {{text: string, selStart: number, selEnd: number}}
 */
function duplicateLines(text, selStart, selEnd, direction) {
  const { lines, first, last } = selectedLines(text, selStart, selEnd),
    block = lines.slice(first, last + 1),
    withCopy = [...lines.slice(0, first), ...block, ...block,
      ...lines.slice(last + 1)],
    // Copying downward, the selection has to move past the original block to
    // land on the copy. Copying upward, the new copy takes the block's old
    // place, so the offsets already point at it.
    shift = direction === 'up' ? 0 : block.join('\n').length + 1;

  return {
    text: withCopy.join('\n'),
    selStart: selStart + shift,
    selEnd: selEnd + shift,
  };
}

/**
 * Remove the selected line(s) entirely, leaving the caret at the start of
 * whichever line moved up to take their place.
 * @param {string} text
 * @param {number} selStart
 * @param {number} selEnd
 * @returns {{text: string, selStart: number, selEnd: number}}
 */
function deleteLines(text, selStart, selEnd) {
  const { lines, offsets, first, last }
      = selectedLines(text, selStart, selEnd),
    remaining = [...lines.slice(0, first), ...lines.slice(last + 1)];

  // Deleting everything still leaves one (empty) line behind:
  if (remaining.length === 0) { remaining.push(''); }

  // Nothing above 'first' moved, and the caret always lands on or above that
  // line, so the offsets worked out before the deletion still hold.
  const caret = offsets[Math.min(first, remaining.length - 1)];

  return { text: remaining.join('\n'), selStart: caret, selEnd: caret };
}

/**
 * Reduce a whole-text rewrite to just the span which differs, by trimming the
 * common prefix and suffix. Replacing only that span keeps each keystroke to a
 * single, tidy entry on the browser's native undo stack.
 * @param {string} oldText
 * @param {string} newText
 * @returns {{start: number, end: number, replacement: string}}
 */
function minimalEdit(oldText, newText) {
  if (oldText === newText) { return { start: 0, end: 0, replacement: '' }; }

  const maxLen = Math.min(oldText.length, newText.length);
  let prefix = 0;
  while (prefix < maxLen && oldText[prefix] === newText[prefix]) {
    prefix += 1;
  }

  // Stop the suffix scan before it runs back into the prefix:
  const oldLast = oldText.length - 1,
    newLast = newText.length - 1;
  let suffix = 0;
  while (suffix < maxLen - prefix
    && oldText[oldLast - suffix] === newText[newLast - suffix]) {
    suffix += 1;
  }

  return {
    start: prefix,
    end: oldText.length - suffix,
    replacement: newText.slice(prefix, newText.length - suffix),
  };
}

/**
 * Where the line under a caret begins and ends, NOT counting its newline.
 * @param {string} text
 * @param {number} pos
 * @returns {{start: number, end: number}}
 */
function lineBoundsAt(text, pos) {
  // Searching backwards from pos - 1 would clamp to 0 at the start of the text
  // and then match a leading newline, landing on the wrong line:
  const start = pos === 0 ? 0 : text.lastIndexOf('\n', pos - 1) + 1,
    nextNewline = text.indexOf('\n', pos),
    end = nextNewline === -1 ? text.length : nextNewline;
  return { start, end };
}

/**
 * The text Ctrl+C / Ctrl+X should put on the clipboard when nothing is
 * selected: the caret's line, always ending with a newline so that pasting it
 * lands as a complete line no matter which line it came from. Returns null when
 * the user HAS selected something, which leaves copy and cut to the browser.
 * @param {string} text
 * @param {number} selStart
 * @param {number} selEnd
 * @returns {?string}
 */
function currentLineText(text, selStart, selEnd) {
  if (selStart !== selEnd) { return null; }
  const { start, end } = lineBoundsAt(text, selStart);
  return `${text.slice(start, end)}\n`;
}

/**
 * The range a Ctrl+X should REMOVE when nothing is selected. This is not the
 * same as what gets copied: to delete a line you also have to take one of the
 * newlines around it, or an empty line is left behind.
 * Returns null when the user HAS selected something.
 * @param {string} text
 * @param {number} selStart
 * @param {number} selEnd
 * @returns {?{start: number, end: number}}
 */
function wholeLineSpan(text, selStart, selEnd) {
  if (selStart !== selEnd) { return null; }

  const { start: lineStart, end: lineEnd } = lineBoundsAt(text, selStart);

  // Normally take the newline which follows the line:
  if (lineEnd < text.length) { return { start: lineStart, end: lineEnd + 1 }; }
  // The last line has no newline of its own, so borrow the one in front of it:
  if (lineStart > 0) { return { start: lineStart - 1, end: lineEnd }; }
  // A single line with no newlines anywhere:
  return { start: lineStart, end: lineEnd };
}

glob.skmHotkeys = {
  toggleComment, moveLines, duplicateLines, deleteLines,
  minimalEdit, wholeLineSpan, currentLineText,
};

// --------------------------- DOM layer -------------------------------------

/**
 * document.execCommand, reporting false rather than throwing.
 * @param {string} command
 * @param {string} [arg]
 * @returns {boolean}
 */
function exec(command, arg) {
  try {
    return document.execCommand(command, false, arg);
  } catch {
    return false;
  }
}

/** Re-render, matching what the textarea's own onkeyup handler does. */
function rerender() {
  if (typeof glob.debounced_process_sankey === 'function') {
    glob.debounced_process_sankey();
  }
}

// 'mod' = Ctrl on Windows/Linux, Command on macOS. Every command takes both, so
// there is nothing for anyone to remember per-platform.
// 'arg' is the transform's 4th argument, where it takes one.
const keyBindings = [
  { key: '/', mod: true, run: toggleComment },
  { key: 'arrowup', alt: true, run: moveLines, arg: 'up' },
  { key: 'arrowdown', alt: true, run: moveLines, arg: 'down' },
  { key: 'arrowup', alt: true, shift: true, run: duplicateLines, arg: 'up' },
  { key: 'arrowdown', alt: true, shift: true, run: duplicateLines, arg: 'down' },
  { key: 'k', mod: true, shift: true, run: deleteLines },
  // Copy/cut the current line, but ONLY when nothing is selected. With a real
  // selection these fall through untouched so ordinary copy and cut behave
  // exactly as the browser intends.
  { key: 'c', mod: true, clipboard: 'copy' },
  { key: 'x', mod: true, clipboard: 'cut' },
];

/**
 * Does a keydown event match this binding exactly? Modifiers which a binding
 * doesn't ask for must be absent, so Ctrl+Alt+/ doesn't fire plain Ctrl+/.
 * @param {object} binding
 * @param {KeyboardEvent} ev
 * @returns {boolean}
 */
function bindingMatches(binding, ev) {
  if (ev.key.toLowerCase() !== binding.key) { return false; }
  if (Boolean(binding.alt) !== ev.altKey) { return false; }
  if (Boolean(binding.shift) !== ev.shiftKey) { return false; }
  if (binding.mod) { return ev.ctrlKey || ev.metaKey; }
  return !ev.ctrlKey && !ev.metaKey;
}

/**
 * Run one transform against a textarea, applying the result in a way which
 * preserves the browser's native undo history.
 * @param {HTMLTextAreaElement} textareaEl
 * @param {object} binding - a keyBindings entry with a 'run' transform
 */
function applyCommand(textareaEl, binding) {
  const before = textareaEl.value,
    result = binding.run(
      before, textareaEl.selectionStart, textareaEl.selectionEnd, binding.arg
    );

  if (result.text !== before) {
    const edit = minimalEdit(before, result.text);
    textareaEl.setSelectionRange(edit.start, edit.end);
    // execCommand is deprecated, but it is still the only way to change a
    // textarea's contents without wiping the undo stack that Ctrl+Z uses.
    // Assigning to .value would make every hotkey un-undoable.
    // Browsers report success inconsistently, so trust the text, not the
    // return value:
    if (edit.replacement === '') { exec('delete'); } else {
      exec('insertText', edit.replacement);
    }
    // Last resort: correct text, but this one edit won't be undoable.
    if (textareaEl.value !== result.text) {
      textareaEl.value = result.text;
    }
  }

  textareaEl.setSelectionRange(result.selStart, result.selEnd);
  rerender();
}

/**
 * Put arbitrary text on the clipboard, by copying it out of a throwaway
 * textarea parked offscreen. Copying straight out of the Diagram Inputs field
 * would only ever reach characters which are really there, and the trailing
 * newline of the last line isn't.
 * @param {string} payload
 * @returns {boolean} true when the copy went through
 */
function toClipboard(payload) {
  const holder = document.createElement('textarea');
  holder.value = payload;
  holder.readOnly = true;
  holder.setAttribute('aria-hidden', 'true');
  // Offscreen rather than hidden: an element which isn't rendered can't be
  // selected, and scrolling must not jump when it is added.
  holder.style.position = 'fixed';
  holder.style.top = '-100px';
  holder.style.opacity = '0';
  document.body.appendChild(holder);
  holder.select();
  // execCommand rather than navigator.clipboard on purpose: the deployed site
  // is served over plain http, where navigator.clipboard does not exist.
  const worked = exec('copy');
  holder.remove();
  return worked;
}

/**
 * Copy (and for a cut, then remove) the line the caret is on.
 * @param {HTMLTextAreaElement} textareaEl
 * @param {string} action - 'copy' or 'cut'
 */
function applyClipboard(textareaEl, action) {
  const text = textareaEl.value,
    selStart = textareaEl.selectionStart,
    selEnd = textareaEl.selectionEnd,
    payload = currentLineText(text, selStart, selEnd);
  if (payload === null) { return; }

  const worked = toClipboard(payload);
  // Selecting the throwaway textarea took the focus with it:
  textareaEl.focus();

  // Never delete anything we failed to keep a copy of:
  if (action === 'copy' || !worked) {
    textareaEl.setSelectionRange(selStart, selEnd);
    return;
  }

  // The range to remove is not the text we copied: a line has to take one of
  // the newlines around it with it, or it leaves a blank line behind.
  const span = wholeLineSpan(text, selStart, selEnd);
  // An empty field gives an empty span, and 'delete' over an empty selection
  // acts as a backspace rather than doing nothing:
  if (span.end > span.start) {
    textareaEl.setSelectionRange(span.start, span.end);
    // 'delete' rather than assigning .value, to stay on the native undo stack:
    exec('delete');
    if (textareaEl.value.length === text.length) {
      // Last resort: correct text, but this one edit won't be undoable.
      textareaEl.value = text.slice(0, span.start) + text.slice(span.end);
    }
  }

  // Land at the start of the line which moved up into its place, clamped in
  // case the cut line was the last one.
  const landing = Math.min(span.start, textareaEl.value.length);
  textareaEl.setSelectionRange(landing, landing);
  rerender();
}

function handleKeydown(ev) {
  const binding = keyBindings.find((b) => bindingMatches(b, ev));
  if (!binding) { return; }
  const textareaEl = ev.target;

  if (binding.clipboard) {
    // A real selection means the user wants an ordinary copy or cut: leave the
    // event alone so the browser does it.
    if (textareaEl.selectionStart !== textareaEl.selectionEnd) { return; }
    ev.preventDefault();
    applyClipboard(textareaEl, binding.clipboard);
    return;
  }

  ev.preventDefault();
  applyCommand(textareaEl, binding);
}

// This file is loaded with 'defer', so the textarea already exists.
if (typeof document !== 'undefined') {
  const inputsEl = document.getElementById(userInputsField);
  if (inputsEl) { inputsEl.addEventListener('keydown', handleKeydown); }
}
}(typeof window === 'undefined' ? global : window));

// Make the linter happy about imported objects:
/* global global userInputsField settingsAppliedPrefix */
