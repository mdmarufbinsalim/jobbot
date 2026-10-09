// Free Gemini captcha solver for the server: the key comes from GEMINI_API_KEY (free key: https://aistudio.google.com/apikey),
// the model from GEMINI_MODEL (default gemini-3.5-flash). See extension/core/captcha/gemini-solver.js.
import { geminiSolver } from '../../extension/core/captcha/gemini-solver.js';

export default geminiSolver({ getKey: () => process.env.GEMINI_API_KEY, getModel: () => process.env.GEMINI_MODEL });
