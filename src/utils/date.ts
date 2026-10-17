/** A DATE / Date as "YYYY-MM-DD" (UTC day, how DATE columns come back from Prisma). */
export const dayString = (d: Date): string => d.toISOString().slice(0, 10);
