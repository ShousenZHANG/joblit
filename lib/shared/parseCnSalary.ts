export function parseCnSalary(raw: string): { min: number; max: number; currency: string; months?: number } | null {
  // Handle "25-50K" or "25-50k" (case insensitive)
  const kMatch = raw.match(/(\d+)-(\d+)[Kk]/);
  if (kMatch) {
    const result = { min: Number(kMatch[1]) * 1000, max: Number(kMatch[2]) * 1000, currency: "CNY" };
    const monthMatch = raw.match(/(\d+)薪/);
    if (monthMatch) return { ...result, months: Number(monthMatch[1]) };
    return result;
  }

  // Handle "2.5-5万" or "2.5-5万/月"
  const wanMatch = raw.match(/([\d.]+)-([\d.]+)万/);
  if (wanMatch) {
    return { min: Number(wanMatch[1]) * 10000, max: Number(wanMatch[2]) * 10000, currency: "CNY" };
  }

  // Unparseable (面议, etc.)
  return null;
}
