import { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "../lib/db";
import { getAdminAllowlistLowercase } from "../lib/accessControl";
import { EncryptionService } from "./encryption.service";

export class TradeNoteAccessDeniedError extends Error {
  status = 403;
  constructor() {
    super("Access denied: you are not allowed to access or modify this note");
    this.name = "TradeNoteAccessDeniedError";
  }
}

export class TradeNoteNotFoundError extends Error {
  status = 404;
  constructor() {
    super("Trade or note not found");
    this.name = "TradeNoteNotFoundError";
  }
}

export class TradeNoteEditWindowExpiredError extends Error {
  status = 403;
  constructor() {
    super("Trade notes can only be edited or deleted within 15 minutes of posting");
    this.name = "TradeNoteEditWindowExpiredError";
  }
}

const NOTE_EDIT_WINDOW_MS = 15 * 60 * 1000;
type NotesDatabase = Pick<PrismaClient, "trade" | "tradeNote" | "$transaction">;

export class TradeNotesService {
  private readonly encryptionService = new EncryptionService();

  constructor(
    private readonly prisma: NotesDatabase = defaultPrisma,
  ) {}

  async addNote(tradeId: string, authorAddress: string, content: string) {
    const trade = await this.prisma.trade.findUnique({ where: { tradeId } });
    if (!trade) throw new TradeNoteNotFoundError();

    const caller = authorAddress.toLowerCase();
    const isParty =
      trade.buyerAddress.toLowerCase() === caller ||
      trade.sellerAddress.toLowerCase() === caller;
    if (!isParty) throw new TradeNoteAccessDeniedError();

    const encrypted = this.encryptionService.encrypt(content, tradeId);

    return this.prisma.tradeNote.create({
      data: {
        tradeId,
        authorAddress: caller,
        content: encrypted,
      },
    });
  }

  async listNotes(tradeId: string, callerAddress: string) {
    const trade = await this.prisma.trade.findUnique({ where: { tradeId } });
    if (!trade) throw new TradeNoteNotFoundError();

    const caller = callerAddress.toLowerCase();
    const isAdmin = getAdminAllowlistLowercase().has(caller);
    const isParty =
      trade.buyerAddress.toLowerCase() === caller ||
      trade.sellerAddress.toLowerCase() === caller;
    if (!isParty && !isAdmin) throw new TradeNoteAccessDeniedError();

    const notes = await this.prisma.tradeNote.findMany({
      where: { tradeId },
      orderBy: { createdAt: "desc" },
    });

    return notes.map((note) => ({
      id: note.id,
      tradeId: note.tradeId,
      authorAddress: note.authorAddress,
      content:
        note.authorAddress === caller || isAdmin
          ? this.encryptionService.decrypt(note.content, tradeId)
          : null,
      createdAt: note.createdAt,
    }));
  }

  async editNote(
    tradeId: string,
    noteId: number,
    callerAddress: string,
    content: string,
  ) {
    const note = await this.findEditableNote(tradeId, noteId, callerAddress);
    const encrypted = this.encryptionService.encrypt(content, tradeId);

    return this.prisma.$transaction(async (transaction) => {
      await transaction.tradeNoteAudit.create({
        data: {
          noteId: note.id,
          tradeId,
          authorAddress: note.authorAddress,
          action: "updated",
          content: note.content,
        },
      });
      return transaction.tradeNote.update({
        where: { id: note.id },
        data: { content: encrypted },
      });
    });
  }

  async deleteNote(tradeId: string, noteId: number, callerAddress: string) {
    const note = await this.findEditableNote(tradeId, noteId, callerAddress);

    await this.prisma.$transaction(async (transaction) => {
      await transaction.tradeNoteAudit.create({
        data: {
          noteId: note.id,
          tradeId,
          authorAddress: note.authorAddress,
          action: "deleted",
          content: note.content,
        },
      });
      await transaction.tradeNote.delete({ where: { id: note.id } });
    });
  }

  private async findEditableNote(
    tradeId: string,
    noteId: number,
    callerAddress: string,
  ) {
    const note = await this.prisma.tradeNote.findUnique({
      where: { id: noteId },
    });
    if (!note || note.tradeId !== tradeId) throw new TradeNoteNotFoundError();
    if (note.authorAddress.toLowerCase() !== callerAddress.toLowerCase()) {
      throw new TradeNoteAccessDeniedError();
    }
    if (Date.now() - note.createdAt.getTime() > NOTE_EDIT_WINDOW_MS) {
      throw new TradeNoteEditWindowExpiredError();
    }
    return note;
  }
}
