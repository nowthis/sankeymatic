// Test suite for TSV flow line parsing
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { reTSVFlowLine } from './constantsProxy.mjs';

/**
 * Test a single TSV flow line against the regex
 * @param {string} input - The TSV line to test
 * @param {Object} expected - Expected match groups
 * @param {string} expected.sourceNode - Expected source node
 * @param {string} expected.amount - Expected amount
 * @param {string} expected.targetNode - Expected target node
 * @param {string} [expected.color] - Expected color (without #)
 * @param {string} [expected.opacity] - Expected opacity
 */
function testTsvLine(input, expected) {
  const match = input.match(reTSVFlowLine);

  if (!match) {
    throw new Error(`Input did not match regex: ${JSON.stringify(input)}`);
  }

  const { groups } = match;

  // Check required groups
  assert.strictEqual(groups.sourceNode, expected.sourceNode, `Source node mismatch for: ${input} (groups: ${JSON.stringify(groups)})`);
  assert.strictEqual(groups.amount, expected.amount, `Amount mismatch for: ${input} (groups: ${JSON.stringify(groups)})`);
  assert.strictEqual(groups.targetNode, expected.targetNode, `Target node mismatch for: ${input} (groups: ${JSON.stringify(groups)})`);

  // Check optional groups
  if ('color' in expected) {
    assert.strictEqual(groups.color, expected.color, `Color mismatch for: ${input} (groups: ${JSON.stringify(groups)})`);
  } else if (groups.color !== "fff" ) { // `fff` special case for tests for convenience
    assert.strictEqual(groups.color, undefined, `Unexpected color in: ${input}`);
  }

  if ('opacity' in expected) {
    assert.strictEqual(groups.opacity, expected.opacity, `Opacity mismatch for: ${input} (groups: ${JSON.stringify(groups)})`);
  } else if (groups.opacity !== ".99") { // `99` special case for tests for convenience
    assert.strictEqual(groups.opacity, undefined, `Unexpected opacity in: ${input}`);
  }
}

describe('TSV Flow Line Parser', () => {
  it('should parse basic TSV line', () => {
    const expected = {
      sourceNode: 'Source',
      amount: '100',
      targetNode: 'Target'
    };
    testTsvLine('Source\t100\tTarget', expected);
    testTsvLine(' Source \t 100 \t Target', expected);
    testTsvLine('  Source \t  100 \t  Target  ', expected);
  });

  it('should parse basic TSV line with escaped tabs in fields', () => {
    const expected = {
      sourceNode: '\\tSource',
      amount: '\\t100',
      targetNode: '\\tTarget'
    };
    testTsvLine('\\tSource\t\\t100\t\\tTarget', expected);
    testTsvLine('  \\tSource  \t  \\t100  \t  \\tTarget  ', expected);
  });

  it('should parse with color', () => {
    const expected = {
      sourceNode: 'Source',
      amount: '100',
      targetNode: 'Target',
      color: 'ff0000'
    };
    testTsvLine('Source\t100\tTarget #ff0000', expected);
    testTsvLine('  Source\t100\tTarget #ff0000', expected);
    testTsvLine('  Source  \t  100  \t  Target  \t  #ff0000  ', expected);
  });

  it('should parse with color and opacity', () => {
    const expected = {
      sourceNode: 'Source',
      amount: '100',
      targetNode: 'Target',
      color: 'ff0000',
      opacity: '.75'
    };
    testTsvLine('Source\t100\tTarget #ff0000.75', expected);
    testTsvLine('  Source\t100\tTarget #ff0000.75', expected);
    testTsvLine('  Source  \t  100  \t  Target  \t  #ff0000.75  ', expected);
  });

  it('should handle 3-digit hex colors', () => {
    const expected = {
      sourceNode: 'Source',
      amount: '100',
      targetNode: 'Target',
      color: 'f00'
    };
    testTsvLine('Source\t100\tTarget #f00', expected);
    testTsvLine('  Source\t100\tTarget #f00', expected);
    testTsvLine('  Source  \t  100  \t  Target  \t  #f00  ', expected);
  });

    it('should parse with just opacity', () => {
    const expected = {
      sourceNode: 'Source',
      amount: '100',
      targetNode: 'Target',
      opacity: '.75'
    };
    testTsvLine('Source\t100\tTarget #.75', expected);
    testTsvLine('  Source\t100\tTarget #.75', expected);
    testTsvLine('  Source  \t  100  \t  Target  \t  #.75  ', expected);
  });

  it('should handle empty amount', () => {
    const expected = {
      sourceNode: 'Source',
      amount: '',
      targetNode: 'Target'
    };
    testTsvLine('Source\t\tTarget', expected);
    testTsvLine('  Source\t\tTarget', expected);
    testTsvLine('  Source  \t  \tTarget  ', expected);
  });

  it('should handle empty target for when target and amaount are flipped', () => {
    const expected = {
      sourceNode: 'Source',
      amount: 'Target',
      targetNode: ''
    };
    testTsvLine('Source\tTarget\t', expected);
    testTsvLine('Source\tTarget\t#fff', expected);
    testTsvLine('Source\tTarget\t#fff.99', expected);
    testTsvLine('  Source  \t  Target  \t  #fff  \t  ', expected);
    testTsvLine('  Source  \t  Target  \t  #fff.99  \t  ', expected);
  });

  it('should handle empty target without last tab', () => {
    const expected = {
      sourceNode: 'Source',
      amount: 'Target',
      targetNode: ''
    };
    testTsvLine('  Source\tTarget\t', expected);
    testTsvLine('  Source  \tTarget  \t', expected);
  });

  it('should handle opacity with 1-4 digits', () => {
    const testCases = [
      { input: '.1', valid: true },
      { input: '.12', valid: true },
      { input: '.123', valid: true },
      { input: '.1234', valid: true },
      { input: '.12345', valid: false },
      { input: '1.2', valid: false }
    ];

    testCases.forEach(({ input, valid }) => {
      const line = `Source\t100\tTarget #${input}`;
      const match = line.match(reTSVFlowLine);

      if (valid) {
        assert(match, `Should match: ${line}`);
        assert.strictEqual(match.groups.opacity, input, `Opacity should be ${input}`);
      } else {
        assert(!match || !match.groups.opacity, `Should not match invalid opacity: ${line}`);
      }
    });
  });

  it('should not match invalid color formats', () => {
    const invalidLines = [
      'Source\t100\tTarget #',
      'Source\t100\tTarget #zzz',
      'Source\t100\tTarget #ff0000.',
      'Source\t100\tTarget #ff0000.abc',
      'Source\t100\tTarget #ff0000.12345'
    ];

    invalidLines.forEach(line => {
      const match = line.match(reTSVFlowLine);
      assert(!match || !match.groups.color, `Should not match invalid color format: ${line}`);
    });
  });
});
