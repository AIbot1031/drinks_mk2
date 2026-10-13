import {catalogVersion} from './catalog-version';
/** Record preference changes and the new snapshot in one D1 transaction.
 * Compare the database snapshot, rather than the earlier session read, so
 * retries and concurrent PUTs do not invent duplicate interaction events.
 */
export function preferenceChangeStatements(userId:string,likedIds:string[],dislikedIds:string[],requestId:string,occurredAt:number) {
  const statements:Array<{sql:string;params:(string|number)[]}>=[];
  const kinds=[
    {field:'likedIds',add:'like',remove:'unlike',values:likedIds},
    {field:'dislikedIds',add:'dislike',remove:'undislike',values:dislikedIds},
  ];
  for(const kind of kinds){
    const next=JSON.stringify(kind.values);
    // field names and actions are fixed constants, never user input.
    const old=`json_each(u.preferences,'$.${kind.field}')`;
    statements.push({sql:`INSERT INTO consumer_interactions(id,user_id,drink_id,action,occurred_at,request_id,catalog_version)
      SELECT ? || ':' || n.value,u.id,n.value,?, ?, ?, ?
      FROM consumer_users u JOIN json_each(?) n
      WHERE u.id=? AND NOT EXISTS(SELECT 1 FROM ${old} o WHERE o.value=n.value)`,
      params:[`${requestId}:${kind.add}`,kind.add,occurredAt,requestId,catalogVersion,next,userId]});
    statements.push({sql:`INSERT INTO consumer_interactions(id,user_id,drink_id,action,occurred_at,request_id,catalog_version)
      SELECT ? || ':' || o.value,u.id,o.value,?, ?, ?, ?
      FROM consumer_users u JOIN ${old} o
      WHERE u.id=? AND NOT EXISTS(SELECT 1 FROM json_each(?) n WHERE n.value=o.value)`,
      params:[`${requestId}:${kind.remove}`,kind.remove,occurredAt,requestId,catalogVersion,userId,next]});
  }
  statements.push({sql:'UPDATE consumer_users SET preferences=? WHERE id=?',params:[JSON.stringify({likedIds,dislikedIds}),userId]});
  return statements;
}

export async function savePreferencesWithEvents(db:D1Database,userId:string,likedIds:string[],dislikedIds:string[]):Promise<void> {
  const statements=preferenceChangeStatements(userId,likedIds,dislikedIds,crypto.randomUUID(),Date.now());
  await db.batch(statements.map(s=>db.prepare(s.sql).bind(...s.params)));
}
