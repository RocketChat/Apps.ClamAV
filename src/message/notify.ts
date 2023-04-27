import { IApp } from "@rocket.chat/apps-engine/definition/IApp";
import { IRead, IModify } from "@rocket.chat/apps-engine/definition/accessors";
import { IMessageAttachment } from "@rocket.chat/apps-engine/definition/messages";
import { IRoom } from "@rocket.chat/apps-engine/definition/rooms";
import { BlockBuilder } from "@rocket.chat/apps-engine/definition/uikit";
import { IUser } from "@rocket.chat/apps-engine/definition/users";

export const notifyUser = async ({
  app,
  read,
  modify,
  room,
  user,
  text,
  attachments,
  blocks,
}: {
  app: IApp;
  read: IRead;
  modify: IModify;
  room: IRoom;
  user: IUser;
  text?: string;
  attachments?: Array<IMessageAttachment>;
  blocks?: BlockBuilder;
}): Promise<void> => {
  const appUser = await read.getUserReader().getAppUser(app.getID());
  if (!appUser) {
    throw new Error('user-not-found');
  }
  const msg = modify
    .getCreator()
    .startMessage()
    .setGroupable(false)
    .setSender(appUser)
    .setRoom(room);

  if (text && text.length > 0) {
    msg.setText(text);
  }
  if (attachments && attachments.length > 0) {
    msg.setAttachments(attachments);
  }
  if (blocks !== undefined) {
    msg.setBlocks(blocks);
  }

  return read.getNotifier().notifyUser(user, msg.getMessage());
};