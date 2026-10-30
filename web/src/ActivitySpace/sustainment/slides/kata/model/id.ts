import { customAlphabet } from "nanoid";

const gen = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 10);

export const newId = (prefix: string) => `${prefix}_${gen()}`;
