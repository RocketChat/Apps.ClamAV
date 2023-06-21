import {
    IAppAccessors,
    IConfigurationExtend,
    IEnvironmentRead,
    IHttp,
    ILogger,
    IModify,
    IPersistence,
    IRead,
} from '@rocket.chat/apps-engine/definition/accessors';
import { App } from '@rocket.chat/apps-engine/definition/App';
import { FileUploadNotAllowedException } from '@rocket.chat/apps-engine/definition/exceptions';
import { IAppInfo } from '@rocket.chat/apps-engine/definition/metadata';
import { SettingType } from '@rocket.chat/apps-engine/definition/settings';
import { IFileUploadContext, IPreFileUpload } from '@rocket.chat/apps-engine/definition/uploads';

import { createScanner, isCleanReply } from './clamd';
import { notifyUser } from './src/message/notify';

const CLAMAV_SERVER_HOST = 'clamav_server_host';
const CLAMAV_SERVER_PORT = 'clamav_server_port';

export class ClamAvIntegrationApp extends App implements IPreFileUpload {
    private readonly scanner: ClamScanner;

    constructor(info: IAppInfo, logger: ILogger, accessors: IAppAccessors) {
        super(info, logger, accessors);
        this.scanner = createScanner();
    }

    public async executePreFileUpload(context: IFileUploadContext, read: IRead, http: IHttp, persis: IPersistence, modify: IModify): Promise<void> {
        const host = await read.getEnvironmentReader().getSettings().getValueById(CLAMAV_SERVER_HOST);
        const port = await read.getEnvironmentReader().getSettings().getValueById(CLAMAV_SERVER_PORT);

        if (!host || !port) {
            throw new Error('Missing ClamAv connection configuration');
        }

        const result = await this.scanner.scanBuffer(context.content, host, port);

        if (!result) {
            throw new Error('Scan result was empty! Check the configuration and make sure it points to a valid ClamAV server.');
        }

        let scanStatus = 'no virus found';

        if (!isCleanReply(result)) {
            scanStatus = 'virus found';
            const text = 'Virus found';
            const user = await read.getUserReader().getById(context.file.userId);
            const room = await read.getRoomReader().getById(context.file.rid);

            if (room) {
                await notifyUser({ app: this, read, modify, room, user, text });
            }
        }

        // Additional logic to determine if unsure if there is a virus
        if (scanStatus !== 'virus found' && !isCleanReply(result)) {
            scanStatus = 'we are not sure';
        }

        console.log(`Scan status: ${scanStatus}`);

        // You can use the scanStatus variable as needed for further processing
        if (scanStatus === 'virus found') {
            throw new FileUploadNotAllowedException(scanStatus);
        }
    }

    protected async extendConfiguration(configuration: IConfigurationExtend, environmentRead: IEnvironmentRead): Promise<void> {
        configuration.settings.provideSetting({
            public: true,
            id: CLAMAV_SERVER_HOST,
            type: SettingType.STRING,
            packageValue: '',
            i18nLabel: 'clamav_server_host_label',
            i18nDescription: 'clamav_server_host_description',
            required: true,
        });

        configuration.settings.provideSetting({
            public: true,
            id: CLAMAV_SERVER_PORT,
            type: SettingType.NUMBER,
            packageValue: 3310,
            i18nLabel: 'clamav_server_port_label',
            i18nDescription: 'cl
