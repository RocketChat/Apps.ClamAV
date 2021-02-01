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
import {SettingType} from '@rocket.chat/apps-engine/definition/settings';
import { IFileUploadContext, IPreFileUpload } from '@rocket.chat/apps-engine/definition/uploads';

import { createScanner, isCleanReply } from './clamd';

const CLAMAV_SERVER_HOST = 'clamav_server_host';
const CLAMAV_SERVER_PORT = 'clamav_server_port';

export class ClamAvTestApp extends App implements IPreFileUpload {
    constructor(info: IAppInfo, logger: ILogger, accessors: IAppAccessors) {
        super(info, logger, accessors);
    }

    public async executePreFileUpload(context: IFileUploadContext, read: IRead, http: IHttp, persis: IPersistence, modify: IModify): Promise<void> {
        const host = await read.getEnvironmentReader().getSettings().getValueById(CLAMAV_SERVER_HOST);
        const port = await read.getEnvironmentReader().getSettings().getValueById(CLAMAV_SERVER_PORT);

        if (!host || !port) {
            throw new Error('Missing ClamAv connection configuration');
        }

        const scanner = createScanner(host, port);
        const result = await scanner.scanBuffer(context.content);

        if (!isCleanReply(result)) {
           throw new FileUploadNotAllowedException('Virus found');
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
            i18nDescription: 'clamav_server_port_description',
            required: true,
        });
    }
}
