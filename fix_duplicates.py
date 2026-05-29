# Remove duplicate tribal-bonus routes, keeping only the first occurrence

content = open('/home/team/shared/backend/src/routes/africanGiants.js').read()

# Split at first occurrence of tribal-bonus routes
marker = '  // GET /african-giants/tribal-bonus/status — Tribal bonus status for any tribe slug'

idx = content.find(marker)
if idx == -1:
    print('Marker not found')
    exit(1)

# Take everything up to (and including) the first block ending at the schedule route's closing });
# Find the second occurrence
idx2 = content.find(marker, idx + 1)
if idx2 != -1:
    print('Found duplicates, removing...')
    # Find end of first schedule route block (the }); after the schedule route)
    # Look for the closing of the schedule route starting at idx
    # Find the second marker and the closing of the first schedule block
    rest = content[idx2:]  # everything from duplicate onward
    
    # Find where the last duplicate ends (at derbies or after last duplicate)
    # The first block spans: marker + status route + schedule route
    # Find end of first schedule block (the closing });)
    # We'll keep the first block and remove all content from idx2 to end of file before '  // GET /african-giants/derbies'
    derby_marker = '  // GET /african-giants/derbies'
    derby_idx = content.find(derby_marker, idx)
    
    # Keep everything from start to derby_marker (first occurrence), remove idx2 to derby_idx (duplicates)
    cleaned = content[:idx2] + content[derby_idx:]
    open('/home/team/shared/backend/src/routes/africanGiants.js', 'w').write(cleaned)
    print('Cleaned, removed duplicates')
else:
    print('No duplicates found, checking for other issues...')
    # Maybe the routes are fine but there's still a problem
    # Let's just verify
    pass

# Verify: count tribal-bonus occurrences
import re
matches = [m.start() for m in re.finditer(r"fastify\.get\('/tribal-bonus/", content)]
print(f"tribal-bonus routes count: {len(matches)}")
if len(matches) > 2:
    print('WARNING: Still more than 2 routes')