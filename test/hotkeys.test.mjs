// Tests for the pure text transforms behind the Diagram Inputs hotkeys.
// These deliberately touch no DOM: each transform takes (text, selStart,
// selEnd) and returns a new {text, selStart, selEnd}.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import '../build/hotkeys.js';

const {
  toggleComment, moveLines, duplicateLines, deleteLines,
  minimalEdit, wholeLineSpan, currentLineText,
} = globalThis.skmHotkeys;

// Helper: mark the selection inside a template string with | (caret) or
// |...| (range), so tests read as what the user actually has selected.
function parse(marked) {
  const first = marked.indexOf('|');
  const rest = marked.indexOf('|', first + 1);
  const text = marked.replaceAll('|', '');
  return {
    text,
    selStart: first,
    selEnd: rest === -1 ? first : rest - 1,
  };
}

function apply(fn, marked, ...args) {
  const { text, selStart, selEnd } = parse(marked);
  const out = fn(text, selStart, selEnd, ...args);
  return `${out.text.slice(0, out.selStart)}|${
    out.selStart === out.selEnd ? '' : `${out.text.slice(out.selStart, out.selEnd)}|`
  }${out.text.slice(out.selEnd)}`;
}

describe('toggleComment', () => {
  test('comments a single uncommented line, keeping the caret column', () => {
    assert.strictEqual(
      apply(toggleComment, 'Wages [15|00] Budget'),
      '// Wages [15|00] Budget'
    );
  });

  test('uncomments a line that is already commented', () => {
    assert.strictEqual(
      apply(toggleComment, '// Wages [15|00] Budget'),
      'Wages [15|00] Budget'
    );
  });

  test("uncomments SankeyMATIC's other comment marker, the apostrophe", () => {
    assert.strictEqual(
      apply(toggleComment, "' Wages [1|50] Budget"),
      'Wages [1|50] Budget'
    );
  });

  test('preserves indentation, commenting after the leading whitespace', () => {
    assert.strictEqual(
      apply(toggleComment, '    Wages [15|00] Budget'),
      '    // Wages [15|00] Budget'
    );
  });

  test('leaves an applied-settings line completely alone', () => {
    // Un-commenting one of these makes process_sankey re-apply the setting
    // and immediately re-comment it, so the keystroke must skip them.
    assert.strictEqual(
      apply(toggleComment, '|// ✓ size_w 600'),
      '|// ✓ size_w 600'
    );
  });

  test('comments every selected line when the whole block is selected', () => {
    assert.strictEqual(
      apply(toggleComment, '|Wages [1500] Budget\nOther [250] Budget|'),
      '|// Wages [1500] Budget\n// Other [250] Budget|'
    );
  });

  test('uncomments the block only when every line is already commented', () => {
    assert.strictEqual(
      apply(toggleComment, '|// Wages [1500] Budget\n// Other [250] Budget|'),
      '|Wages [1500] Budget\nOther [250] Budget|'
    );
  });

  test('comments the whole block when only some lines are commented', () => {
    assert.strictEqual(
      apply(toggleComment, '|// Wages [1500] Budget\nOther [250] Budget|'),
      '|// // Wages [1500] Budget\n// Other [250] Budget|'
    );
  });

  test('skips blank lines when commenting a block', () => {
    assert.strictEqual(
      apply(toggleComment, '|Wages [1500] Budget\n\nOther [250] Budget|'),
      '|// Wages [1500] Budget\n\n// Other [250] Budget|'
    );
  });

  test('toggles normal lines while leaving applied-settings lines intact', () => {
    assert.strictEqual(
      apply(toggleComment, '|Wages [1500] Budget\n// ✓ size_w 600\nOther [250] Budget|'),
      '|// Wages [1500] Budget\n// ✓ size_w 600\n// Other [250] Budget|'
    );
  });

  test('ignores applied-settings lines when deciding comment vs uncomment', () => {
    assert.strictEqual(
      apply(toggleComment, '|// Wages [1500] Budget\n// ✓ size_w 600\n// Other [250] Budget|'),
      '|Wages [1500] Budget\n// ✓ size_w 600\nOther [250] Budget|'
    );
  });
});

describe('moveLines', () => {
  test('swaps a line with the one below it', () => {
    assert.strictEqual(
      apply(moveLines, '|Wages\nOther', 'down'),
      'Other\n|Wages'
    );
  });

  test('swaps a line with the one above it', () => {
    assert.strictEqual(
      apply(moveLines, 'Wages\n|Other', 'up'),
      '|Other\nWages'
    );
  });

  test('does nothing when already at the top', () => {
    assert.strictEqual(
      apply(moveLines, '|Wages\nOther', 'up'),
      '|Wages\nOther'
    );
  });

  test('does nothing when already at the bottom', () => {
    assert.strictEqual(
      apply(moveLines, 'Wages\n|Other', 'down'),
      'Wages\n|Other'
    );
  });

  test('moves a multi-line selection as one block', () => {
    assert.strictEqual(
      apply(moveLines, 'A\n|B\nC|\nD', 'down'),
      'A\nD\n|B\nC|'
    );
  });

  test('carries the caret column along with the moved line', () => {
    assert.strictEqual(
      apply(moveLines, 'Wages [15|00] Budget\nOther', 'down'),
      'Other\nWages [15|00] Budget'
    );
  });
});

describe('duplicateLines', () => {
  test('copies the line below, leaving the caret on the new copy', () => {
    assert.strictEqual(
      apply(duplicateLines, '|Wages', 'down'),
      'Wages\n|Wages'
    );
  });

  test('copies the line above, leaving the caret on the new upper copy', () => {
    assert.strictEqual(apply(duplicateLines, '|Wages', 'up'), '|Wages\nWages');
  });

  test('copies a whole multi-line block', () => {
    assert.strictEqual(
      apply(duplicateLines, '|A\nB|\nC', 'down'),
      'A\nB\n|A\nB|\nC'
    );
  });

  test('keeps the caret column on the copy', () => {
    assert.strictEqual(
      apply(duplicateLines, 'Wages [15|00] Budget', 'down'),
      'Wages [1500] Budget\nWages [15|00] Budget'
    );
  });
});

describe('deleteLines', () => {
  test("removes the caret's line", () => {
    assert.strictEqual(apply(deleteLines, 'A\n|B\nC'), 'A\n|C');
  });

  test('removes every selected line', () => {
    assert.strictEqual(apply(deleteLines, 'A\n|B\nC|\nD'), 'A\n|D');
  });

  test('puts the caret on the new last line when deleting the last one', () => {
    assert.strictEqual(apply(deleteLines, 'A\n|B'), '|A');
  });

  test('leaves an empty input when deleting the only line', () => {
    assert.strictEqual(apply(deleteLines, '|A'), '|');
  });
});

// minimalEdit narrows a whole-text rewrite down to the span that actually
// changed. The DOM layer replaces only that span, so the browser's native
// undo stack gets one tidy entry per keystroke instead of a full-buffer swap.
describe('minimalEdit', () => {
  test('finds a single changed character', () => {
    assert.deepStrictEqual(
      minimalEdit('abc', 'aXc'),
      { start: 1, end: 2, replacement: 'X' }
    );
  });

  test('describes a pure insertion as an empty range', () => {
    assert.deepStrictEqual(
      minimalEdit('ac', 'abc'),
      { start: 1, end: 1, replacement: 'b' }
    );
  });

  test('describes a pure deletion as an empty replacement', () => {
    assert.deepStrictEqual(
      minimalEdit('abc', 'ac'),
      { start: 1, end: 2, replacement: '' }
    );
  });

  test('reports no edit at all when the text is unchanged', () => {
    assert.deepStrictEqual(
      minimalEdit('abc', 'abc'),
      { start: 0, end: 0, replacement: '' }
    );
  });

  test('narrows a two-line comment toggle to the middle of the text', () => {
    const before = 'A\nB',
      after = '// A\n// B',
      edit = minimalEdit(before, after);
    assert.strictEqual(
      before.slice(0, edit.start) + edit.replacement + before.slice(edit.end),
      after
    );
    assert.strictEqual(edit.start, 0);
    assert.strictEqual(edit.end, 2);
  });

  test('round-trips every transform back to the full new text', () => {
    const before = 'Wages [1500] Budget\nOther [250] Budget\nBudget [450] Tax',
      after = toggleComment(before, 0, before.length).text,
      edit = minimalEdit(before, after);
    assert.strictEqual(
      before.slice(0, edit.start) + edit.replacement + before.slice(edit.end),
      after
    );
  });
});

// wholeLineSpan picks the range that Ctrl+C / Ctrl+X should act on when the
// caret is sitting on a line with nothing selected. It returns null when there
// IS a selection, so a normal copy/cut is left entirely to the browser.
describe('wholeLineSpan', () => {
  test('covers the line plus its trailing newline', () => {
    // 'A\nB\nC' -- caret on B. The newline comes along so a paste makes a line.
    assert.deepStrictEqual(
      wholeLineSpan('A\nB\nC', 2, 2),
      { start: 2, end: 4 }
    );
  });

  test('takes the preceding newline for a last line that has none', () => {
    assert.deepStrictEqual(wholeLineSpan('A\nB', 2, 2), { start: 1, end: 3 });
  });

  test('covers just the text when there is only one line', () => {
    assert.deepStrictEqual(wholeLineSpan('A', 0, 0), { start: 0, end: 1 });
  });

  test('covers the newline alone on a blank line', () => {
    assert.deepStrictEqual(wholeLineSpan('A\n\nB', 2, 2), { start: 2, end: 3 });
  });

  test('picks the right line when the caret sits at its end', () => {
    assert.deepStrictEqual(
      wholeLineSpan('A\nBB\nC', 4, 4),
      { start: 2, end: 5 }
    );
  });

  test('picks the right line from the middle of a longer line', () => {
    // Caret is on the second (last) line, so the newline before it is taken.
    const text = 'Wages [1500] Budget\nOther [250] Budget';
    assert.deepStrictEqual(wholeLineSpan(text, 25, 25), { start: 19, end: 38 });
  });

  test('takes the first line when the caret is at the very start', () => {
    // Guards a subtle trap: searching backwards from position 0 must not find
    // the newline which ENDS this (empty) line and skip to the second one.
    assert.deepStrictEqual(wholeLineSpan('\nA', 0, 0), { start: 0, end: 1 });
  });

  test('returns null when text is selected, so copy/cut stays native', () => {
    assert.strictEqual(wholeLineSpan('A\nB\nC', 2, 3), null);
  });
});

// currentLineText is what actually lands on the clipboard. It always ends with
// a newline so that a pasted line arrives as a whole line, wherever it came
// from -- which a plain selection can't achieve for the LAST line, since that
// line has no newline of its own to select.
describe('currentLineText', () => {
  test('copies the line with its trailing newline', () => {
    assert.strictEqual(currentLineText('A\nB\nC', 2, 2), 'B\n');
  });

  test('ends the LAST line with a newline too, not a leading one', () => {
    // The whole point: selecting the last line can only reach the newline in
    // FRONT of it, which would paste as '\nB' and behave inconsistently.
    assert.strictEqual(currentLineText('A\nB', 2, 2), 'B\n');
  });

  test('adds a newline to a single-line input', () => {
    assert.strictEqual(currentLineText('A', 0, 0), 'A\n');
  });

  test('copies a blank line as just a newline', () => {
    assert.strictEqual(currentLineText('A\n\nB', 2, 2), '\n');
  });

  test('takes the first line when the caret is at the very start', () => {
    assert.strictEqual(currentLineText('\nA', 0, 0), '\n');
  });

  test('copies the whole line from a caret in the middle of it', () => {
    const text = 'Wages [1500] Budget\nOther [250] Budget';
    assert.strictEqual(currentLineText(text, 25, 25), 'Other [250] Budget\n');
  });

  test('copies the line the caret ends on, not the next one', () => {
    assert.strictEqual(currentLineText('A\nBB\nC', 4, 4), 'BB\n');
  });

  test('returns null when text is selected, so copy/cut stays native', () => {
    assert.strictEqual(currentLineText('A\nB\nC', 2, 3), null);
  });
});
