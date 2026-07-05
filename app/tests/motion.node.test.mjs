// Motion (Tanda 1) — parte PURA de $lib/motion.js: formato europeo manual + easing.
// (countUp/inView son acciones DOM: se verifican en navegador real; aquí lo determinista.)
import { fmtCount, easeOutExpo, DUR, prefersReducedMotion } from '../src/lib/motion.js';

let failures = 0;
const check = (name, ok) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failures++;
};

console.log('Ocio Shit — motion (fundación)\n');

// fmtCount: notación europea MANUAL (coma decimal, punto de miles) — constraint dura
check('fmtCount(0) = "0"', fmtCount(0) === '0');
check('fmtCount(7) = "7"', fmtCount(7) === '7');
check('fmtCount(1234) = "1.234"', fmtCount(1234) === '1.234');
check('fmtCount(4480) = "4.480"', fmtCount(4480) === '4.480');
check('fmtCount(1234567) = "1.234.567"', fmtCount(1234567) === '1.234.567');
check('fmtCount(82.92, 2) = "82,92"', fmtCount(82.92, 2) === '82,92');
check('fmtCount(6211.5, 1) = "6.211,5"', fmtCount(6211.5, 1) === '6.211,5');
check('fmtCount(9.5, 1) = "9,5"', fmtCount(9.5, 1) === '9,5');
check('fmtCount redondea (82.926, 2) = "82,93"', fmtCount(82.926, 2) === '82,93');
check('fmtCount negativo (-1234.5, 1) = "-1.234,5"', fmtCount(-1234.5, 1) === '-1.234,5');
check('fmtCount basura → "0"', fmtCount(undefined) === '0' && fmtCount(NaN) === '0');

// easeOutExpo: extremos exactos + monótona creciente en [0,1]
check('easeOutExpo(0) = 0', easeOutExpo(0) === 0);
check('easeOutExpo(1) = 1', easeOutExpo(1) === 1);
let mono = true;
for (let i = 1; i <= 100; i++) if (easeOutExpo(i / 100) < easeOutExpo((i - 1) / 100)) mono = false;
check('easeOutExpo monótona en [0,1]', mono);
check('easeOutExpo(0.5) ya cerca del final (>0.9, es expo)', easeOutExpo(0.5) > 0.9 && easeOutExpo(0.5) < 1);

// tokens espejo + reduced-motion seguro sin window (SSR/node)
check('DUR espejo de los tokens CSS (150/300/600)', DUR.fast === 150 && DUR.base === 300 && DUR.slow === 600);
check('prefersReducedMotion() sin window → false (no rompe en SSR)', prefersReducedMotion() === false);

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}\n`);
process.exit(failures === 0 ? 0 : 1);
