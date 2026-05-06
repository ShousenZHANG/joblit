import { NextResponse } from "next/server";
import { withSessionRoute } from "@/lib/server/api/routeHandler";
import { z } from "zod";
import { prisma } from "@/lib/server/prisma";

export const runtime = "nodejs";

const TimeZoneSchema = z
  .string()
  .min(1)
  .max(100)
  .optional()
  .transform((value) => value ?? "UTC");

function getDatePartsInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
  };
}

function getTimeZoneOffset(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  );
  return asUtc - date.getTime();
}

function getUtcStartOfLocalDate(
  year: number,
  month: number,
  day: number,
  timeZone: string,
) {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  const offset = getTimeZoneOffset(utcGuess, timeZone);
  return new Date(utcGuess.getTime() - offset);
}

function getTodayRangeUtc(timeZone: string) {
  const now = new Date();
  const { year, month, day } = getDatePartsInTimeZone(now, timeZone);
  const start = getUtcStartOfLocalDate(year, month, day, timeZone);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  const nextParts = {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
  const end = getUtcStartOfLocalDate(nextParts.year, nextParts.month, nextParts.day, timeZone);
  const localDate = `${String(year).padStart(4, "0")}-${String(month).padStart(
    2,
    "0",
  )}-${String(day).padStart(2, "0")}`;
  return { start, end, localDate };
}

export async function GET(req: Request) {
  return withSessionRoute(async ({ userId }) => {
  const tzHeader = req.headers.get("x-user-timezone") ?? undefined;
  const timeZone = TimeZoneSchema.parse(tzHeader);
  const { start, end, localDate } = getTodayRangeUtc(timeZone);

  const [checkins, remainingNew] = await Promise.all([
    prisma.dailyCheckin.findMany({
      where: { userId },
      select: { localDate: true },
      orderBy: { localDate: "desc" },
    }),
    prisma.job.count({
      where: {
        userId,
        status: "NEW",
        createdAt: {
          gte: start,
          lt: end,
        },
      },
    }),
  ]);

  const checkedInToday = checkins.some((it) => it.localDate === localDate);

  return NextResponse.json({
    dates: checkins.map((it) => it.localDate),
    localDate,
    remainingNew,
    checkedInToday,
  });
  });
}

export async function POST(req: Request) {
  return withSessionRoute(async ({ userId }) => {
  const tzHeader = req.headers.get("x-user-timezone") ?? undefined;
  const timeZone = TimeZoneSchema.parse(tzHeader);
  const { start, end, localDate } = getTodayRangeUtc(timeZone);

  const remainingNew = await prisma.job.count({
    where: {
      userId,
      status: "NEW",
      createdAt: {
        gte: start,
        lt: end,
      },
    },
  });

  if (remainingNew > 0) {
    return NextResponse.json(
      { error: "HAS_NEW", remainingNew },
      { status: 400 },
    );
  }

  await prisma.dailyCheckin.upsert({
    where: { userId_localDate: { userId, localDate } },
    update: { checkedAt: new Date() },
    create: { userId, localDate },
  });

  return NextResponse.json({ ok: true, localDate });
  });
}
