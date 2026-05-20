/* ========================================
   JavaScript Execution Visualizer — Engine
   ======================================== */

// ---- Default sample code ----
const DEFAULT_CODE = `var a = 10;

function greet() {
   console.log("Hello");
}

greet();

console.log(a);`;

// ---- DOM references ----
const codeInput    = document.getElementById('codeInput');
const lineNumbers  = document.getElementById('lineNumbers');
const btnRun       = document.getElementById('btnRun');
const btnPrev      = document.getElementById('btnPrev');
const btnNext      = document.getElementById('btnNext');
const btnReset     = document.getElementById('btnReset');
const btnAutoPlay  = document.getElementById('btnAutoPlay');
const phaseBadge   = document.getElementById('phaseBadge');
const stepDesc     = document.getElementById('stepDescription');
const memoryBody   = document.getElementById('memoryTableBody');
const memoryLabel  = document.getElementById('memoryPhaseLabel');
const callStackDiv = document.getElementById('callStackContent');
const consoleDiv   = document.getElementById('consoleContent');

// ---- State ----
let steps        = [];
let currentStep  = -1;
let autoPlayId   = null;
let highlightLine = -1;

// ---- Init ----
codeInput.value = DEFAULT_CODE;
updateLineNumbers();

codeInput.addEventListener('input', updateLineNumbers);
codeInput.addEventListener('scroll', syncScroll);

function syncScroll() {
  lineNumbers.scrollTop = codeInput.scrollTop;
}

function updateLineNumbers() {
  const lines = codeInput.value.split('\n');
  lineNumbers.innerHTML = lines
    .map((_, i) => `<div class="leading-6 ${i === highlightLine ? 'text-purple-400' : ''}" data-line="${i}">${i + 1}</div>`)
    .join('');
}
function setHighlight(line) {
  highlightLine = line;
  // Remove previous highlights
  lineNumbers.querySelectorAll('div').forEach(d => {
    d.classList.remove('text-purple-400', 'font-bold');
  });
  // Highlight target line
  if (line >= 0) {
    const el = lineNumbers.querySelector(`[data-line="${line}"]`);
    if (el) {
      el.classList.add('text-purple-400', 'font-bold');
      // Scroll into view
      const lineH = 24; // leading-6 = 24px
      const visibleStart = codeInput.scrollTop;
      const visibleEnd = visibleStart + codeInput.clientHeight;
      const pos = line * lineH;
      if (pos < visibleStart || pos + lineH > visibleEnd) {
        codeInput.scrollTop = pos - codeInput.clientHeight / 3;
        lineNumbers.scrollTop = codeInput.scrollTop;
      }
    }
  }
}

// ---- Parser & Step Generator ----

function extractFunctionBody(lines, startLine) {
  // lines[startLine] contains "function name() {"
  // Find matching closing brace
  let depth = 0;
  let started = false;
  let bodyStart = -1;
  let bodyEnd = -1;

  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i];
    for (let j = 0; j < line.length; j++) {
      if (line[j] === '{') {
        depth++;
        if (!started) {
          started = true;
          bodyStart = i + 1; // body starts on next line
        }
      }
      if (line[j] === '}') {
        depth--;
        if (started && depth === 0) {
          bodyEnd = i - 1;
          return { bodyStart, bodyEnd, endLine: i };
        }
      }
    }
  }
  return { bodyStart, bodyEnd: bodyStart - 1, endLine: lines.length - 1 };
}

function resolveValue(expr, memory) {
  expr = expr.trim().replace(/;+$/, '');
  // String literal
  if ((expr.startsWith('"') && expr.endsWith('"')) ||
      (expr.startsWith("'") && expr.endsWith("'"))) {
    return expr;
  }
  // Number
  if (/^-?\d+(\.\d+)?$/.test(expr)) return expr;
  // Boolean
  if (expr === 'true' || expr === 'false') return expr;
  // null / undefined
  if (expr === 'null') return 'null';
  if (expr === 'undefined') return 'undefined';
  // Variable lookup
  if (memory[expr] !== undefined) return String(memory[expr].value);
  return expr;
}

function resolveLogArg(arg, memory) {
  arg = arg.trim();
  if ((arg.startsWith('"') && arg.endsWith('"')) ||
      (arg.startsWith("'") && arg.endsWith("'"))) {
    return arg.slice(1, -1);
  }
  if (memory[arg] !== undefined) return String(memory[arg].value);
  if (!isNaN(arg)) return arg;
  return arg;
}

function generateSteps(code) {
  const lines = code.split('\n');
  const allSteps = [];

  // Running state during generation
  const mem = {};
  const cstack = ['global'];
  const con = [];

  function snapshot() {
    return {
      memory:     JSON.parse(JSON.stringify(mem)),
      callStack:  [...cstack],
      console:    [...con]
    };
  }

  function pushStep(overrides) {
    const s = { ...snapshot(), ...overrides };
    allSteps.push(s);
  }

  // ---- First pass: find function declarations ----
  const fnDecls = [];    // { name, line, bodyStart, bodyEnd, endLine }
  const fnSkipSet = new Set();

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const fnMatch = trimmed.match(/^function\s+(\w+)\s*\(/);
    if (fnMatch) {
      const { bodyStart, bodyEnd, endLine } = extractFunctionBody(lines, i);
      fnDecls.push({ name: fnMatch[1], line: i, bodyStart, bodyEnd, endLine });
      for (let k = i; k <= endLine; k++) fnSkipSet.add(k);
    }
  }

  // ---- Phase 1: Memory Creation ----
  pushStep({
    type: 'phase-memory-start',
    desc: 'Memory Creation Phase — hoisting variables & functions...',
    line: -1,
    phase: 'memory-creation'
  });

  // Hoist var declarations (top-level only, skip function bodies)
  for (let i = 0; i < lines.length; i++) {
    if (fnSkipSet.has(i)) continue;
    const trimmed = lines[i].trim();
    const varMatch = trimmed.match(/^var\s+(\w+)/);
    if (varMatch) {
      mem[varMatch[1]] = { value: 'undefined', type: 'variable' };
      pushStep({
        type: 'memory-var',
        name: varMatch[1],
        desc: `var ${varMatch[1]} → undefined (hoisted)`,
        line: i,
        phase: 'memory-creation'
      });
    }
  }

  // Hoist function declarations
  for (const fn of fnDecls) {
    mem[fn.name] = { value: 'function', type: 'function' };
    pushStep({
      type: 'memory-fn',
      name: fn.name,
      desc: `function ${fn.name}() → hoisted`,
      line: fn.line,
      phase: 'memory-creation'
    });
  }

  if (allSteps.length === 1) {
    // Only the phase-start step; no variables or functions found
    pushStep({
      type: 'memory-empty',
      desc: 'No variable or function declarations found to hoist',
      line: -1,
      phase: 'memory-creation'
    });
  }

  // ---- Phase 2: Thread of Execution ----
  pushStep({
    type: 'phase-exec-start',
    desc: 'Thread of Execution begins',
    line: -1,
    phase: 'execution'
  });

  for (let i = 0; i < lines.length; i++) {
    if (fnSkipSet.has(i)) continue;

    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    // --- var x = value ---
    let m = trimmed.match(/^var\s+(\w+)\s*=\s*(.+?)\s*;?\s*$/);
    if (m) {
      const val = resolveValue(m[2], mem);
      mem[m[1]] = { value: val, type: 'variable' };
      pushStep({
        type: 'assign',
        name: m[1],
        value: val,
        desc: `${m[1]} = ${val}`,
        line: i,
        phase: 'execution'
      });
      continue;
    }

    // --- x = value (assignment without var) ---
    m = trimmed.match(/^(\w+)\s*=\s*(.+?)\s*;?\s*$/);
    if (m && !trimmed.startsWith('var') && !trimmed.startsWith('function')) {
      const val = resolveValue(m[2], mem);
      mem[m[1]] = { value: val, type: 'variable' };
      pushStep({
        type: 'assign',
        name: m[1],
        value: val,
        desc: `${m[1]} = ${val}`,
        line: i,
        phase: 'execution'
      });
      continue;
    }

    // --- function call: name() ---
    m = trimmed.match(/^(\w+)\s*\(\s*\)\s*;?\s*$/);
    if (m) {
      const fn = fnDecls.find(f => f.name === m[1]);
      if (fn) {
        // Push to call stack
        cstack.push(fn.name);
        pushStep({
          type: 'fn-call',
          name: fn.name,
          desc: `Calling ${fn.name}() — pushed to call stack`,
          line: i,
          phase: 'execution'
        });

        // Execute function body lines
        if (fn.bodyStart >= 0 && fn.bodyEnd >= fn.bodyStart) {
          for (let j = fn.bodyStart; j <= fn.bodyEnd; j++) {
            const bline = lines[j].trim();
            const clog = bline.match(/^console\.log\s*\((.+?)\)\s*;?\s*$/);
            if (clog) {
              const resolved = resolveLogArg(clog[1], mem);
              con.push(resolved);
              pushStep({
                type: 'console-log',
                value: resolved,
                desc: `console.log → "${resolved}"`,
                line: j,
                phase: 'execution'
              });
            }
          }
        }

        // Pop from call stack
        cstack.pop();
        pushStep({
          type: 'fn-return',
          name: fn.name,
          desc: `${fn.name}() returns — popped from call stack`,
          line: -1,
          phase: 'execution'
        });
      }
      continue;
    }

    // --- console.log(...) ---
    m = trimmed.match(/^console\.log\s*\((.+?)\)\s*;?\s*$/);
    if (m) {
      const resolved = resolveLogArg(m[1], mem);
      con.push(resolved);
      pushStep({
        type: 'console-log',
        value: resolved,
        desc: `console.log → "${resolved}"`,
        line: i,
        phase: 'execution'
      });
      continue;
    }
  }

  // ---- Done ----
  pushStep({
    type: 'done',
    desc: 'Execution complete',
    line: -1,
    phase: 'done'
  });

  return allSteps;
}

// ---- Rendering ----

function renderStep(index) {
  if (index < 0 || index >= steps.length) return;

  const step = steps[index];

  // Phase badge
  phaseBadge.textContent = phaseLabel(step.phase);
  phaseBadge.className = 'px-3 py-1 rounded-full text-xs font-semibold border transition-all duration-300';
  if (step.phase === 'memory-creation') {
    phaseBadge.classList.add('bg-blue-500/15', 'text-blue-300', 'border-blue-500/40', 'phase-active');
  } else if (step.phase === 'execution') {
    phaseBadge.classList.add('bg-amber-500/15', 'text-amber-300', 'border-amber-500/40', 'phase-active');
  } else if (step.phase === 'done') {
    phaseBadge.classList.add('bg-green-500/15', 'text-green-300', 'border-green-500/40');
  } else {
    phaseBadge.classList.add('bg-gray-700', 'text-gray-300', 'border-gray-600');
  }

  // Description
  stepDesc.textContent = step.desc || '';
  stepDesc.classList.remove('step-desc-update');
  void stepDesc.offsetWidth;
  stepDesc.classList.add('step-desc-update');

  // Memory panel
  renderMemory(step);

  // Call stack
  renderCallStack(step);

  // Console
  renderConsole(step);

  // Line highlight
  setHighlight(step.line >= 0 ? step.line : -1);

  // Button states
  btnPrev.disabled = (index <= 0);
  btnNext.disabled = (index >= steps.length - 1);
  btnAutoPlay.disabled = (index >= steps.length - 1);
}

function phaseLabel(phase) {
  switch (phase) {
    case 'memory-creation': return 'Memory Phase';
    case 'execution':       return 'Execution Phase';
    case 'done':            return 'Complete';
    default:                return 'Ready';
  }
}

function renderMemory(step) {
  memoryLabel.textContent = step.phase === 'memory-creation'
    ? '(Memory Creation)'
    : step.phase === 'execution'
      ? '(Execution)'
      : '';

  const entries = Object.entries(step.memory);
  if (entries.length === 0) {
    memoryBody.innerHTML = '<tr><td colspan="3" class="py-4 text-center text-gray-600 text-xs">No variables yet</td></tr>';
    return;
  }

  memoryBody.innerHTML = entries.map(([name, info]) => {
    const valClass = info.value === 'undefined'
      ? 'text-gray-500 italic'
      : info.value === 'function'
        ? 'text-purple-400'
        : 'text-neon-green';
    const typeClass = info.type === 'function'
      ? 'text-purple-400/60'
      : 'text-gray-500';
    return `
      <tr class="border-b border-gray-700/20 memory-row-updated">
        <td class="py-1.5 font-semibold text-gray-200">${escapeHTML(name)}</td>
        <td class="py-1.5 ${valClass}">${escapeHTML(String(info.value))}</td>
        <td class="py-1.5 text-xs ${typeClass}">${info.type}</td>
      </tr>`;
  }).join('');
}

function renderCallStack(step) {
  if (step.callStack.length === 0) {
    callStackDiv.innerHTML = '<div class="text-xs text-gray-600">Empty</div>';
    return;
  }
  callStackDiv.innerHTML = step.callStack
    .slice() // don't reverse original
    .reverse()
    .map((name, i) => {
      const isTop = i === 0;
      return `<div class="stack-entry px-3 py-1.5 rounded-lg text-xs font-semibold ${
        isTop
          ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
          : 'bg-gray-700/30 text-gray-400 border border-gray-600/20'
      }">${escapeHTML(name)}${isTop ? ' (top)' : ''}</div>`;
    })
    .join('');
}

function renderConsole(step) {
  if (step.console.length === 0) {
    consoleDiv.innerHTML = '<div class="text-xs text-gray-600">—</div>';
    return;
  }
  consoleDiv.innerHTML = step.console
    .map((val, i) => `<div class="console-entry text-neon-green flex gap-2">
      <span class="text-gray-600 shrink-0">&gt;</span>
      <span>${escapeHTML(String(val))}</span>
    </div>`)
    .join('');
}

function escapeHTML(str) {
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}

// ---- Navigation ----

function goToStep(index) {
  if (index < 0 || index >= steps.length) return;
  currentStep = index;
  renderStep(currentStep);
}

function resetAll() {
  stopAutoPlay();
  steps = [];
  currentStep = -1;
  highlightLine = -1;
  updateLineNumbers();
  phaseBadge.textContent = 'Ready';
  phaseBadge.className = 'px-3 py-1 rounded-full text-xs font-semibold bg-gray-700 text-gray-300 border border-gray-600';
  stepDesc.textContent = 'Click "Run Visualization" to begin';
  stepDesc.classList.remove('step-desc-update');
  memoryLabel.textContent = '—';
  memoryBody.innerHTML = '<tr><td colspan="3" class="py-4 text-center text-gray-600 text-xs">No variables yet</td></tr>';
  callStackDiv.innerHTML = '<div class="text-xs text-gray-600">Empty</div>';
  consoleDiv.innerHTML = '<div class="text-xs text-gray-600">—</div>';
  btnPrev.disabled = true;
  btnNext.disabled = true;
  btnAutoPlay.disabled = true;
  btnAutoPlay.textContent = 'Auto Play';
}

function runVisualization() {
  resetAll();
  const code = codeInput.value.trim();
  if (!code) {
    stepDesc.textContent = 'Please enter some JavaScript code first.';
    return;
  }
  steps = generateSteps(code);
  goToStep(0);
}

function nextStep() {
  if (currentStep < steps.length - 1) {
    goToStep(currentStep + 1);
  } else {
    stopAutoPlay();
  }
}

function prevStep() {
  if (currentStep > 0) {
    goToStep(currentStep - 1);
  }
}

function stopAutoPlay() {
  if (autoPlayId) {
    clearInterval(autoPlayId);
    autoPlayId = null;
  }
  btnAutoPlay.textContent = 'Auto Play';
}

function toggleAutoPlay() {
  if (autoPlayId) {
    stopAutoPlay();
    return;
  }
  if (currentStep >= steps.length - 1) {
    goToStep(0);
  }
  btnAutoPlay.textContent = 'Pause';
  autoPlayId = setInterval(() => {
    if (currentStep >= steps.length - 1) {
      stopAutoPlay();
      return;
    }
    nextStep();
  }, 600);
}

// ---- Event listeners ----
btnRun.addEventListener('click', runVisualization);
btnNext.addEventListener('click', nextStep);
btnPrev.addEventListener('click', prevStep);
btnReset.addEventListener('click', resetAll);
btnAutoPlay.addEventListener('click', toggleAutoPlay);

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'TEXTAREA') return; // don't intercept typing
  if (e.key === 'ArrowRight') nextStep();
  if (e.key === 'ArrowLeft')  prevStep();
  if (e.key === 'r' && e.ctrlKey) {
    e.preventDefault();
    runVisualization();
  }
});