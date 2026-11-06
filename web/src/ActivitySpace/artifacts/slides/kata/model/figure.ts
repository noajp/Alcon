// 「数字の見出し」かどうか。画面と PowerPoint の両方で同じ判定を使う
const UNIT = "(%|％|倍|社|人|名|件|円|万円|億円|兆円|日|時間|分|ヶ月|か月|カ月|年|点|割|pt|ポイント|台|店|本|回|km|kg|t)";
const NUMERIC_HEAD = new RegExp(`^[+\\-−▲△±]?(約|月|年|最大|平均)?[0-9０-９][0-9０-９,，.．]*\\s*(万|億|千|兆)?\\s*${UNIT}?$`);

// 英語の数字の見出し：62%、$1.2M、3x、4.6M users、18 hires、1.3x、120/month、approx. 38,000 firms
const EN_NUMERIC_HEAD =
  /^(?:[+\-−±~]|(?:approx\.?|about|up to|over|under|avg\.?|max\.?)\s)?[$¥€£]?[0-9]+(?:[,.][0-9]+)*\s?(?:[kKMB]|bn|million|billion|trillion)?\s?(?:%|x|×|pts?|points|users|customers|clients|firms|companies|factories|hires|engineers|people|members|employees|stores|days|weeks|months|years|hours|hrs|mins?|quotes|deals|orders|times)?(?:\s?\/\s?(?:month|mo|year|yr|week|wk|day))?$/i;

export function isNumericHead(head: string): boolean {
  const t = head.trim();
  if (/[A-Za-z$¥€£]/.test(t) && !/[\u3000-\u30ff\u3400-\u9fff\uff00-\uffef]/.test(t)) {
    if (!t || t.length > 24 || /^[0-9]{4}$/.test(t)) return false;
    return EN_NUMERIC_HEAD.test(t);
  }
  if (!t || t.length > 10) return false;
  if (/^[0-9０-９]{4}年$/.test(t)) return false; // 2024年 は年号
  return NUMERIC_HEAD.test(t);
}
