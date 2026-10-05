import { generateTestData } from './js/testdata.js';
import { parseFlightLog, getStats } from './js/parser.js';

try {
    const buffer = generateTestData();
    const records = parseFlightLog(buffer);
    console.log("Records parsed:", records.length);
    console.log("Stats:", getStats(records));
} catch (e) {
    console.error("FAILED:", e);
}
