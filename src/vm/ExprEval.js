// ============================================================================
// LuckEngine-Web — src/vm/ExprEval.js
// ----------------------------------------------------------------------------
// PORTAGE FIDÈLE de game/expr/{expr.go,utils.go} de LuckSystem.
// Évaluateur d'expressions par pile (shunting-yard) : variables (#NNNN),
// entiers, opérateurs + - * / % & ^ | << >> > < >= <= == != && || avec
// priorités, et parenthèses. Variables = clés chaîne (ex. "#6001").
// ============================================================================

const OP_CHARS = "+-*/%()[]{}><=|&^!";

function isOperator(ch) {
  return OP_CHARS.includes(ch);
}
function isOperator2(ch, ch2) {
  const pairs = ["<<", ">>", "==", "!=", "<=", ">=", "||", "&&"];
  return pairs.includes(ch + ch2);
}
function operatorLevel(word) {
  const level = [
    ["*", "/", "%"],
    ["+", "-"],
    ["<<", ">>"],
    [">", ">=", "<", "<="],
    ["==", "!="],
    ["&"],
    ["^"],
    ["|"],
    ["&&"],
    ["||"],
    ["="],
  ];
  for (let i = 0; i < level.length; i++) {
    if (level[i].includes(word)) return 10 - i;
  }
  return -1;
}
function calc(A, B, op) {
  switch (op) {
    case "+": return A + B;
    case "-": return A - B;
    case "*": return A * B;
    case "/": return B === 0 ? 0 : Math.trunc(A / B);
    case "%": return B === 0 ? 0 : A % B;
    case "&": return A & B;
    case "^": return A ^ B;
    case "|": return A | B;
    case ">>": return A >> B;
    case "<<": return A << B;
    case "&&": return A !== 0 && B !== 0 ? 1 : 0;
    case "||": return A !== 0 || B !== 0 ? 1 : 0;
    case ">": return A > B ? 1 : 0;
    case "<": return A < B ? 1 : 0;
    case ">=": return A >= B ? 1 : 0;
    case "<=": return A <= B ? 1 : 0;
    case "==": return A === B ? 1 : 0;
    case "!=": return A !== B ? 1 : 0;
    default: return 0;
  }
}

const T_OP = 0, T_NUM = 1, T_VAR = 2;

// Convertit l'expression en notation polonaise inverse (RPN).
function parser(exprStr) {
  if (exprStr[0] !== "(") exprStr = "(" + exprStr + ")";
  const tokens = [];
  const stack = [];
  let word = "";
  let isNum = false;

  for (let i = 0; i < exprStr.length; i++) {
    const ch = exprStr[i];
    if (ch === " " || isOperator(ch)) {
      if (word.length > 0) {
        tokens.push({ data: word, type: isNum ? T_NUM : T_VAR });
        isNum = false;
        word = "";
      }
      if (ch === " ") continue;
      let sword = ch;
      if (i + 1 < exprStr.length && isOperator2(ch, exprStr[i + 1])) {
        sword += exprStr[i + 1];
        i++;
      }
      if (sword === ")") {
        let top = stack[stack.length - 1];
        while (top !== undefined && top !== "(") {
          stack.pop();
          tokens.push({ data: top, type: T_OP });
          top = stack[stack.length - 1];
        }
        stack.pop(); // retire "("
      } else if (sword === "(") {
        stack.push(sword);
      } else {
        let top = stack[stack.length - 1];
        while (top !== undefined && operatorLevel(sword) <= operatorLevel(top)) {
          stack.pop();
          tokens.push({ data: top, type: T_OP });
          top = stack[stack.length - 1];
        }
        stack.push(sword);
      }
      continue;
    }
    if (word.length === 0) isNum = ch >= "0" && ch <= "9";
    word += ch;
  }
  while (stack.length > 0) tokens.push({ data: stack.pop(), type: T_OP });
  return tokens;
}

function exec(tokens, variable) {
  const stack = [];
  for (const t of tokens) {
    if (t.type === T_VAR) {
      const v = variable instanceof Map ? variable.get(t.data) : variable[t.data];
      stack.push(Number.isFinite(v) ? v : 0);
    } else if (t.type === T_NUM) {
      stack.push(parseInt(t.data, 10));
    } else {
      if (stack.length < 2) return null;
      const B = stack.pop();
      const A = stack.pop();
      stack.push(calc(A, B, t.data));
    }
  }
  return stack.length ? stack[stack.length - 1] : null;
}

/** Valeur entière de l'expression (number) ou null si invalide. (= ONGOTO) */
export function evalExprValue(exprStr, variable = {}) {
  if (typeof exprStr !== "string" || exprStr.length === 0) return null;
  try {
    return exec(parser(exprStr), variable);
  } catch {
    return null;
  }
}

/** Booléen (résultat != 0) ou null. (= IFN/IFY) */
export function evalExpr(exprStr, variable = {}) {
  const v = evalExprValue(exprStr, variable);
  return v === null ? null : v !== 0;
}
