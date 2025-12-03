import * as myob from '../code-api/servers/myob';

function escOData(s: string) {
  return s.replace(/'/g, "''");
}

export async function findContactsByName(name: string) {
  const filter = `substringof('${escOData(name)}',DisplayName) eq true`;
  const select = 'ContactID,DisplayName,FirstName,LastName,Email';
  const pageSize = 50;
  const maxPages = 3;

  let total = 0;
  const sample: Array<{ id?: any; displayName?: any; email?: any }> = [];
  let skip = 0;

  for (let page = 0; page < maxPages; page++) {
    const res = await myob.Contact_GetList({ $filter: filter, $select: select, $top: pageSize, $skip: skip });

    const rows =
      (res as any)?.structuredContent?.data ??
      (res as any)?.data ??
      [];

    const batch = (Array.isArray(rows) ? rows : []).map((r: any) => ({
      id: r?.ContactID?.value,
      displayName: r?.DisplayName?.value,
      email: r?.Email?.value,
    }));

    total += batch.length;
    for (const b of batch) {
      if (sample.length < 5) sample.push(b);
    }
    if (batch.length < pageSize) break;
    skip += pageSize;
  }

  console.log(`Contacts match count: ${total}`);
  console.log(sample);

  return { count: total, sample };
}
