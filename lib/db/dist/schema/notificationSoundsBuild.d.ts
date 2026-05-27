export type BundledSoundEntry = {
    slug: string;
    checksum: string;
};
/**
 * Single-row table tracking which manifest hash the most recent EAS mobile
 * build was produced from. The mobile build sync script POSTs the new hash
 * after writing files into the Expo project so the admin UI can show a
 * per-sound "in current mobile build" indicator.
 */
export declare const notificationSoundsBuildTable: import("drizzle-orm/pg-core").PgTableWithColumns<{
    name: "notification_sounds_build";
    schema: undefined;
    columns: {
        id: import("drizzle-orm/pg-core").PgColumn<{
            name: "id";
            tableName: "notification_sounds_build";
            dataType: "number";
            columnType: "PgInteger";
            data: number;
            driverParam: string | number;
            notNull: true;
            hasDefault: true;
            isPrimaryKey: true;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        manifestHash: import("drizzle-orm/pg-core").PgColumn<{
            name: "manifest_hash";
            tableName: "notification_sounds_build";
            dataType: "string";
            columnType: "PgText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        bundledSounds: import("drizzle-orm/pg-core").PgColumn<{
            name: "bundled_sounds";
            tableName: "notification_sounds_build";
            dataType: "json";
            columnType: "PgJsonb";
            data: BundledSoundEntry[];
            driverParam: unknown;
            notNull: false;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {
            $type: BundledSoundEntry[];
        }>;
        updatedAt: import("drizzle-orm/pg-core").PgColumn<{
            name: "updated_at";
            tableName: "notification_sounds_build";
            dataType: "date";
            columnType: "PgTimestamp";
            data: Date;
            driverParam: string;
            notNull: true;
            hasDefault: true;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
    };
    dialect: "pg";
}>;
export type NotificationSoundsBuild = typeof notificationSoundsBuildTable.$inferSelect;
//# sourceMappingURL=notificationSoundsBuild.d.ts.map