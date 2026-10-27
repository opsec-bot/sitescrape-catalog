# sitescrape-catalog

Endpoints for [sitescrape](https://github.com/opsec-bot/sitescrape), one folder per site.

| Endpoint | What it returns |
|---|---|
| `resy.com/search` | Restaurants on Resy by text and city: cuisine, neighborhood, price, rating, phone, location |

## Use

```
git clone <this repo> && cd sitescrape-catalog
npm install
npx sitescrape list
npx sitescrape call resy.com/search '{"query":"pizza","city":"new-york-ny"}'
npx sitescrape mcp      # every endpoint as an MCP tool
```

Or keep sitescrape elsewhere and set `SITESCRAPE_CATALOG=/path/to/sitescrape-catalog/catalog`.

## Add or fix an endpoint

1. `npx sitescrape record https://site.com/ --task "what you want"`
2. Write `catalog/<site>/<name>.ts` from the digest (sitescrape's `skill/SKILL.md` walks an agent through it).
3. Save the response as a fixture in `test/fixtures/` and add a test that runs the endpoint on it.
4. `npm test`, then open a pull request.

Rules: no secrets in endpoint files or fixtures (keys the site ships in its own frontend are read at runtime, not committed), action endpoints marked `kind: "action"`, and check the site's terms first.

## License

MIT
