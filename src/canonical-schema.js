// Runtime contract for docs/data-spec.md and the FN-004 whole validator.
export const CANONICAL_SCHEMA_VERSION = 1;
export const ID_PATTERNS = {
  works: /^W[0-9]{5}$/, songs: /^[MAJTBORH][0-9]{5}$/,
  creators: /^C[0-9]{5}$/, artists: /^G[0-9]{5}$/,
  members: /^P[0-9]{5}$/, releases: /^L[0-9]{5}$/, videos: /^V[0-9]{5}$/
};

const field = (name, type = "string", required = false, extra = {}) => ({ name, type, required, ...extra });
const text = (name, required = false) => field(name, "string", required);
const id = (name, target, required = true) => field(name, "id", required, { pattern: ID_PATTERNS[target], target });
const date = (name, required = false) => field(name, "date", required);
const integer = (name, required = false, min = 1) => field(name, "integer", required, { min });
const enumeration = (name, values) => field(name, "enum", true, { values });
const source = (required = true) => field("source_url", "url", required);
const timestamps = () => [field("created_at", "datetime", true), field("updated_at", "datetime", true)];
const fk = (column, table) => ({ columns: [column], table, targetColumns: [column] });
const table = (name, columns, primaryKey, extra = {}) => ({
  name, path: `data/${name}.csv`, columns, primaryKey, foreignKeys: [], unique: [], orders: [], ...extra
});

export const CANONICAL_TABLES = [
  table("artists", [id("artist_id", "artists"), text("name", true),
    enumeration("type", ["group", "solo", "temporary_unit", "shuffle_unit", "special_unit", "project", "trainee", "other"]),
    date("start_date"), date("end_date"), text("notes"), source(false), ...timestamps()], ["artist_id"], { period: ["start_date", "end_date"] }),
  table("creators", [id("creator_id", "creators"), text("name", true), text("name_kana"), text("notes"), source(false), ...timestamps()], ["creator_id"]),
  table("works", [id("work_id", "works"), text("title", true), text("title_kana"), text("notes"), source(), ...timestamps()], ["work_id"]),
  table("songs", [id("song_id", "songs"), id("work_id", "works"), text("title", true), text("version_name"),
    enumeration("version_type", ["original", "new_vocal", "re_recording", "cover", "other"]),
    date("release_date"), text("notes"), source(), ...timestamps()], ["song_id"], {
    foreignKeys: [fk("work_id", "works")],
    requiredRelation: { table: "song_artists", column: "song_id", where: { role: "primary" }, code: "PRIMARY_ARTIST_MISSING" }
  }),
  table("song_artists", [id("song_id", "songs"), id("artist_id", "artists"), enumeration("role", ["primary", "featured"]), integer("credit_order"), source()],
    ["song_id", "artist_id", "role"], { foreignKeys: [fk("song_id", "songs"), fk("artist_id", "artists")], orders: [{ scope: ["song_id", "role"], column: "credit_order" }] }),
  table("song_creators", [id("song_id", "songs"), id("creator_id", "creators"),
    enumeration("role", ["lyrics", "english_lyrics", "composition", "arrangement", "brass_arrangement"]), text("credit_name", true), integer("credit_order"), source()],
    ["song_id", "creator_id", "role"], { foreignKeys: [fk("song_id", "songs"), fk("creator_id", "creators")], orders: [{ scope: ["song_id", "role"], column: "credit_order" }] }),
  table("members", [id("member_id", "members"), text("name", true), text("name_kana"), date("birth_date"), text("notes"), source(false), ...timestamps()], ["member_id"]),
  table("member_affiliations", [id("member_id", "members"), id("artist_id", "artists"), date("start_date", true), date("end_date"), text("notes"), source()],
    ["member_id", "artist_id", "start_date"], { foreignKeys: [fk("member_id", "members"), fk("artist_id", "artists")], period: ["start_date", "end_date"], nonOverlapping: ["member_id", "artist_id"] }),
  table("song_performers", [id("song_id", "songs"), id("member_id", "members"), integer("performer_order"), text("notes"), source()],
    ["song_id", "member_id"], { foreignKeys: [fk("song_id", "songs"), fk("member_id", "members")], orders: [{ scope: ["song_id"], column: "performer_order" }] }),
  table("releases", [id("release_id", "releases"), text("title", true), enumeration("release_type", ["single", "album", "digital", "other"]),
    date("release_date"), text("catalog_number"), text("notes"), source(), ...timestamps()], ["release_id"]),
  table("release_tracks", [id("release_id", "releases"), integer("disc_number", true), integer("track_number", true), id("song_id", "songs"), text("track_title", true), text("notes"), source()],
    ["release_id", "disc_number", "track_number"], { foreignKeys: [fk("release_id", "releases"), fk("song_id", "songs")] }),
  table("videos", [id("video_id", "videos"), text("youtube_video_id", true), text("title", true), text("channel_name", true), text("channel_id"),
    date("published_date", true), field("url", "url", true), text("notes"), source(), ...timestamps()], ["video_id"], { unique: [["youtube_video_id"], ["url"]] }),
  table("video_songs", [id("video_id", "videos"), id("song_id", "songs"), integer("start_seconds", true, 0), id("performer_artist_id", "artists", false),
    text("performer_credit", true), text("event_name"), date("event_date"), text("notes"), source()], ["video_id", "song_id", "start_seconds"], {
    foreignKeys: [fk("video_id", "videos"), fk("song_id", "songs"), { columns: ["performer_artist_id"], table: "artists", targetColumns: ["artist_id"] }]
  }),
  table("video_song_performers", [id("video_id", "videos"), id("song_id", "songs"), integer("start_seconds", true, 0), id("member_id", "members"), integer("performer_order"), text("notes"), source()],
    ["video_id", "song_id", "start_seconds", "member_id"], {
      foreignKeys: [{ columns: ["video_id", "song_id", "start_seconds"], table: "video_songs", targetColumns: ["video_id", "song_id", "start_seconds"] }, fk("member_id", "members")],
      orders: [{ scope: ["video_id", "song_id", "start_seconds"], column: "performer_order" }]
    })
];

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
freeze(ID_PATTERNS);
freeze(CANONICAL_TABLES);
export const CANONICAL_SCHEMA = freeze(Object.fromEntries(CANONICAL_TABLES.map((item) => [item.name, item])));
