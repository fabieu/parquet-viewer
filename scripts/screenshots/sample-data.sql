-- Generates the sample data for the README screenshots: a made-up year of NYC
-- yellow-cab trips (real zone names, ~38M rows) and a small zone lookup table.
-- Run with the DuckDB CLI from the output directory; `pnpm screenshots` does this.
SELECT setseed(0.42);
CREATE TABLE zones AS SELECT * FROM (VALUES
 (1,'EWR','Newark Airport','EWR',1),(132,'Queens','JFK Airport','Airports',6),(138,'Queens','LaGuardia Airport','Airports',5),
 (161,'Manhattan','Midtown Center','Yellow Zone',9),(162,'Manhattan','Midtown East','Yellow Zone',8),(163,'Manhattan','Midtown North','Yellow Zone',6),
 (164,'Manhattan','Midtown South','Yellow Zone',6),(186,'Manhattan','Penn Station/Madison Sq West','Yellow Zone',7),(230,'Manhattan','Times Sq/Theatre District','Yellow Zone',7),
 (236,'Manhattan','Upper East Side North','Yellow Zone',8),(237,'Manhattan','Upper East Side South','Yellow Zone',9),(238,'Manhattan','Upper West Side North','Yellow Zone',5),
 (239,'Manhattan','Upper West Side South','Yellow Zone',6),(142,'Manhattan','Lincoln Square East','Yellow Zone',6),(170,'Manhattan','Murray Hill','Yellow Zone',6),
 (234,'Manhattan','Union Sq','Yellow Zone',5),(249,'Manhattan','West Village','Yellow Zone',4),(79,'Manhattan','East Village','Boro Zone',5),
 (107,'Manhattan','Gramercy','Yellow Zone',4),(48,'Manhattan','Clinton East','Yellow Zone',5),(68,'Manhattan','East Chelsea','Yellow Zone',5),
 (100,'Manhattan','Garment District','Yellow Zone',4),(140,'Manhattan','Lenox Hill East','Yellow Zone',4),(141,'Manhattan','Lenox Hill West','Yellow Zone',5),
 (87,'Manhattan','Financial District North','Yellow Zone',3),(231,'Manhattan','TriBeCa/Civic Center','Yellow Zone',3),(113,'Manhattan','Greenwich Village North','Yellow Zone',3),
 (246,'Manhattan','West Chelsea/Hudson Yards','Yellow Zone',3),(43,'Manhattan','Central Park','Yellow Zone',3),(262,'Manhattan','Yorkville East','Yellow Zone',2),
 (148,'Manhattan','Lower East Side','Yellow Zone',2),(144,'Manhattan','Little Italy/NoLiTa','Yellow Zone',2),(7,'Queens','Astoria','Boro Zone',1),
 (65,'Brooklyn','Downtown Brooklyn/MetroTech','Boro Zone',1),(181,'Brooklyn','Park Slope','Boro Zone',1),(255,'Brooklyn','Williamsburg (North Side)','Boro Zone',1)
) t(LocationID, Borough, Zone, service_zone, weight);
COPY (SELECT LocationID, Borough, Zone, service_zone FROM zones ORDER BY LocationID) TO 'taxi_zones.parquet' (FORMAT parquet);
-- Each zone repeated `weight` times, so a uniform index picks zones by weight.
CREATE TABLE picks AS SELECT list(Zone ORDER BY LocationID) AS zones FROM zones, range(weight);
COPY (
  WITH trips AS (
    SELECT i, zones[floor(random() * len(zones))::INT + 1] AS pickup_zone, zones[floor(random() * len(zones))::INT + 1] AS dropoff_zone,
      random() AS r1, random() AS r2, random() AS r3, random() AS r4, random() AS r5
    FROM range(38310226) r(i), picks
  ), priced AS (
    SELECT *,
      round(least(CASE WHEN airport THEN 9 + 10 * -ln(1 - r1 * 0.9995) ELSE 0.3 + 1.6 * -ln(1 - r1 * 0.999) END, 182.37), 2) AS trip_distance,
      date_trunc('second', TIMESTAMP '2024-01-01 00:00:00' + to_microseconds((i::HUGEINT * 31622400000000 // 38310226)::BIGINT)) AS pickup_at
    FROM (SELECT *, pickup_zone IN ('JFK Airport', 'LaGuardia Airport', 'Newark Airport') OR dropoff_zone IN ('JFK Airport', 'LaGuardia Airport', 'Newark Airport') AS airport FROM trips)
  ), fares AS (
    SELECT *, round(3 + 2.8 * trip_distance + 4 * r3, 2) AS fare,
      CASE WHEN r4 < 0.76 THEN 'Credit card' WHEN r4 < 0.93 THEN 'Cash' WHEN r4 < 0.985 THEN 'No charge' WHEN r4 < 0.995 THEN 'Dispute' END AS payment_type
    FROM priced
  ), tipped AS (
    SELECT *, CASE WHEN payment_type = 'Credit card' THEN round(fare * (0.1 + 0.15 * r4), 2) ELSE 0 END AS tip
    FROM fares
  )
  SELECT
    (i + 100000000)::BIGINT AS trip_id,
    pickup_at,
    pickup_at + to_seconds((120 + trip_distance * 150 * (0.7 + r5))::BIGINT) AS dropoff_at,
    CASE WHEN r5 < 0.27 THEN 'Creative Mobile' WHEN r5 < 0.95 THEN 'Curb Mobility' WHEN r5 < 0.97 THEN 'Myle' END AS vendor,
    CASE WHEN r3 < 0.04 THEN NULL WHEN r2 < 0.75 THEN 1 WHEN r2 < 0.9 THEN 2 WHEN r2 < 0.95 THEN 3 ELSE 4 END::INTEGER AS passenger_count,
    trip_distance, pickup_zone, dropoff_zone, payment_type,
    fare::DECIMAL(10,2) AS fare_amount,
    tip::DECIMAL(10,2) AS tip_amount,
    (fare + tip + CASE WHEN airport THEN 6.75 ELSE 4.5 END)::DECIMAL(10,2) AS total_amount
  FROM tipped
  ORDER BY trip_id
) TO 'yellow_tripdata_2024.parquet' (FORMAT parquet, ROW_GROUP_SIZE 1048576);
