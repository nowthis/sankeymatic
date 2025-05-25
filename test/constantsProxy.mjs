// this is a bit of a hack to allow minimal refactoring to the original code while supporting esm for the tests
import { readFileSync } from 'node:fs';
const constantsCode = readFileSync('./build/constants.js', { encoding: 'utf8' });

const constants = await import('data:text/javascript;charset=utf-8,' +encodeURIComponent(constantsCode + '\n export default { reTSVFlowLine, reFlowLine };'));
export const { reTSVFlowLine, reFlowLine } = constants.default;
