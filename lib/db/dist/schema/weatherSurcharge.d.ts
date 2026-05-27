/**
 * Conditions that trigger a weather surcharge. Any condition that is set
 * acts as an OR — when ANY threshold is crossed in the latest reading the
 * rule applies. Unset (null) thresholds are ignored.
 */
export interface WeatherConditions {
    /** Rain mm in the last hour. >= triggers. */
    rainMmGte?: number | null;
    /** Snow mm in the last hour. >= triggers. */
    snowMmGte?: number | null;
    /** Temperature in Celsius. <= triggers (cold extreme). */
    tempCLte?: number | null;
    /** Temperature in Celsius. >= triggers (hot extreme). */
    tempCGte?: number | null;
    /** Wind speed in m/s. >= triggers. */
    windMsGte?: number | null;
    /** OpenWeather "main" condition id matches (e.g. "Thunderstorm", "Snow"). */
    weatherMain?: string[] | null;
}
/**
 * A single OpenWeather observation snapshot for a (lat, lng) point.
 * Stored so rule evaluation never blocks a rider request on a network call
 * to OpenWeather. Updated by the polling job every ~15 minutes.
 */
export declare const weatherReadingsCacheTable: import("drizzle-orm/pg-core").PgTableWithColumns<{
    name: "weather_readings_cache";
    schema: undefined;
    columns: {
        id: import("drizzle-orm/pg-core").PgColumn<{
            name: "id";
            tableName: "weather_readings_cache";
            dataType: "string";
            columnType: "PgUUID";
            data: string;
            driverParam: string;
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
        scope: import("drizzle-orm/pg-core").PgColumn<{
            name: "scope";
            tableName: "weather_readings_cache";
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
        lat: import("drizzle-orm/pg-core").PgColumn<{
            name: "lat";
            tableName: "weather_readings_cache";
            dataType: "number";
            columnType: "PgDoublePrecision";
            data: number;
            driverParam: string | number;
            notNull: true;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        lng: import("drizzle-orm/pg-core").PgColumn<{
            name: "lng";
            tableName: "weather_readings_cache";
            dataType: "number";
            columnType: "PgDoublePrecision";
            data: number;
            driverParam: string | number;
            notNull: true;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        rainMm: import("drizzle-orm/pg-core").PgColumn<{
            name: "rain_mm";
            tableName: "weather_readings_cache";
            dataType: "number";
            columnType: "PgDoublePrecision";
            data: number;
            driverParam: string | number;
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
        snowMm: import("drizzle-orm/pg-core").PgColumn<{
            name: "snow_mm";
            tableName: "weather_readings_cache";
            dataType: "number";
            columnType: "PgDoublePrecision";
            data: number;
            driverParam: string | number;
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
        tempC: import("drizzle-orm/pg-core").PgColumn<{
            name: "temp_c";
            tableName: "weather_readings_cache";
            dataType: "number";
            columnType: "PgDoublePrecision";
            data: number;
            driverParam: string | number;
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
        windMs: import("drizzle-orm/pg-core").PgColumn<{
            name: "wind_ms";
            tableName: "weather_readings_cache";
            dataType: "number";
            columnType: "PgDoublePrecision";
            data: number;
            driverParam: string | number;
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
        weatherMain: import("drizzle-orm/pg-core").PgColumn<{
            name: "weather_main";
            tableName: "weather_readings_cache";
            dataType: "string";
            columnType: "PgText";
            data: string;
            driverParam: string;
            notNull: false;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        weatherDescription: import("drizzle-orm/pg-core").PgColumn<{
            name: "weather_description";
            tableName: "weather_readings_cache";
            dataType: "string";
            columnType: "PgText";
            data: string;
            driverParam: string;
            notNull: false;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        observedAt: import("drizzle-orm/pg-core").PgColumn<{
            name: "observed_at";
            tableName: "weather_readings_cache";
            dataType: "date";
            columnType: "PgTimestamp";
            data: Date;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        fetchedAt: import("drizzle-orm/pg-core").PgColumn<{
            name: "fetched_at";
            tableName: "weather_readings_cache";
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
export type WeatherReading = typeof weatherReadingsCacheTable.$inferSelect;
/**
 * Admin-defined surcharge rule. Scope is one of:
 *  - "country"      → applies to every ride whose pickup country matches `countryIso`.
 *  - "service_area" → applies when pickup falls inside the polygon of `serviceAreaId`.
 *
 * When more than one rule matches, the highest effective surcharge wins.
 *
 * Surcharge model:
 *  - kind = "multiplier" → multiply the (base+distance+time+peak+night) subtotal by `value`.
 *  - kind = "fixed"      → add a fixed amount to the subtotal (in the fare currency).
 */
export declare const weatherSurchargeRulesTable: import("drizzle-orm/pg-core").PgTableWithColumns<{
    name: "weather_surcharge_rules";
    schema: undefined;
    columns: {
        id: import("drizzle-orm/pg-core").PgColumn<{
            name: "id";
            tableName: "weather_surcharge_rules";
            dataType: "string";
            columnType: "PgUUID";
            data: string;
            driverParam: string;
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
        name: import("drizzle-orm/pg-core").PgColumn<{
            name: "name";
            tableName: "weather_surcharge_rules";
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
        scope: import("drizzle-orm/pg-core").PgColumn<{
            name: "scope";
            tableName: "weather_surcharge_rules";
            dataType: "string";
            columnType: "PgText";
            data: "country" | "service_area";
            driverParam: string;
            notNull: true;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: ["country", "service_area"];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        countryIso: import("drizzle-orm/pg-core").PgColumn<{
            name: "country_iso";
            tableName: "weather_surcharge_rules";
            dataType: "string";
            columnType: "PgText";
            data: string;
            driverParam: string;
            notNull: false;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        serviceAreaId: import("drizzle-orm/pg-core").PgColumn<{
            name: "service_area_id";
            tableName: "weather_surcharge_rules";
            dataType: "string";
            columnType: "PgUUID";
            data: string;
            driverParam: string;
            notNull: false;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        conditions: import("drizzle-orm/pg-core").PgColumn<{
            name: "conditions";
            tableName: "weather_surcharge_rules";
            dataType: "json";
            columnType: "PgJsonb";
            data: WeatherConditions;
            driverParam: unknown;
            notNull: true;
            hasDefault: true;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {
            $type: WeatherConditions;
        }>;
        kind: import("drizzle-orm/pg-core").PgColumn<{
            name: "kind";
            tableName: "weather_surcharge_rules";
            dataType: "string";
            columnType: "PgText";
            data: "fixed" | "multiplier";
            driverParam: string;
            notNull: true;
            hasDefault: true;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: ["multiplier", "fixed"];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        value: import("drizzle-orm/pg-core").PgColumn<{
            name: "value";
            tableName: "weather_surcharge_rules";
            dataType: "number";
            columnType: "PgDoublePrecision";
            data: number;
            driverParam: string | number;
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
        startTime: import("drizzle-orm/pg-core").PgColumn<{
            name: "start_time";
            tableName: "weather_surcharge_rules";
            dataType: "string";
            columnType: "PgText";
            data: string;
            driverParam: string;
            notNull: false;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        endTime: import("drizzle-orm/pg-core").PgColumn<{
            name: "end_time";
            tableName: "weather_surcharge_rules";
            dataType: "string";
            columnType: "PgText";
            data: string;
            driverParam: string;
            notNull: false;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        daysOfWeek: import("drizzle-orm/pg-core").PgColumn<{
            name: "days_of_week";
            tableName: "weather_surcharge_rules";
            dataType: "array";
            columnType: "PgArray";
            data: number[];
            driverParam: string | (string | number)[];
            notNull: false;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: import("drizzle-orm").Column<{
                name: "days_of_week";
                tableName: "weather_surcharge_rules";
                dataType: "number";
                columnType: "PgInteger";
                data: number;
                driverParam: string | number;
                notNull: false;
                hasDefault: false;
                isPrimaryKey: false;
                isAutoincrement: false;
                hasRuntimeDefault: false;
                enumValues: undefined;
                baseColumn: never;
                identity: undefined;
                generated: undefined;
            }, {}, {}>;
            identity: undefined;
            generated: undefined;
        }, {}, {
            baseBuilder: import("drizzle-orm/pg-core").PgColumnBuilder<{
                name: "days_of_week";
                dataType: "number";
                columnType: "PgInteger";
                data: number;
                driverParam: number | string;
                enumValues: undefined;
            }, {}, {}, import("drizzle-orm").ColumnBuilderExtraConfig>;
            size: undefined;
        }>;
        active: import("drizzle-orm/pg-core").PgColumn<{
            name: "active";
            tableName: "weather_surcharge_rules";
            dataType: "boolean";
            columnType: "PgBoolean";
            data: boolean;
            driverParam: boolean;
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
        createdAt: import("drizzle-orm/pg-core").PgColumn<{
            name: "created_at";
            tableName: "weather_surcharge_rules";
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
        updatedAt: import("drizzle-orm/pg-core").PgColumn<{
            name: "updated_at";
            tableName: "weather_surcharge_rules";
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
export type WeatherSurchargeRule = typeof weatherSurchargeRulesTable.$inferSelect;
export type InsertWeatherSurchargeRule = typeof weatherSurchargeRulesTable.$inferInsert;
//# sourceMappingURL=weatherSurcharge.d.ts.map