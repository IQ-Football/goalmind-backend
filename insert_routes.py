import sys
content = open('/home/team/shared/backend/src/routes/africanGiants.js').read()
insert_point = content.find('  // GET /african-giants/derbies')
if insert_point == -1:
    print('NOT FOUND')
    sys.exit(1)

new_routes = """  // GET /african-giants/tribal-bonus/status — Tribal bonus status for any tribe slug
  fastify.get('/tribal-bonus/status', async (request, reply) => {
    const { tribe_slug } = request.query;
    if (!tribe_slug) {
      return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'tribe_slug query param required' } });
    }
    try {
      const bonus = await getTribalBonusMultiplier(fastify, tribe_slug);
      const giant = await getGiantOfTheDay(fastify);
      return reply.send({ success: true, data: {
        queryTribeSlug: tribe_slug,
        isTribalBonus: bonus.isTribalBonus,
        multiplier: bonus.multiplier,
        todayGiantSlug: bonus.giantSlug,
        todayGiantName: bonus.giantName,
        giantOfTheDay: giant,
      }});
    } catch (err) { fastify.log.error(err); return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: "Failed to check tribal bonus status" } }); }
  });

  // GET /african-giants/tribal-bonus/schedule — Full 12-tribe rotation schedule (next 12 days)
  fastify.get('/tribal-bonus/schedule', async (request, reply) => {
    try {
      const slugs = Array.from(SUPER_TRIBE_SLUGS);
      const today = new Date();
      const schedule = slugs.map((slug, i) => {
        const date = new Date(today); date.setDate(today.getDate() + i);
        return { tribeSlug: slug, date: date.toISOString().split('T')[0], dayLabel: date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }), isToday: i === 0 };
      });
      return reply.send({ success: true, data: { schedule, totalTribes: slugs.length, currentGiant: schedule[0].tribeSlug, currentGiantDate: schedule[0].date } });
    } catch (err) { fastify.log.error(err); return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: "Failed to fetch schedule" } }); }
  });

"""
result = content[:insert_point] + new_routes + content[insert_point:]
open('/home/team/shared/backend/src/routes/africanGiants.js', 'w').write(result)
print('Done, inserted tribal bonus routes')