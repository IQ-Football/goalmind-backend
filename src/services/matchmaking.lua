-- Redis Lua Script for Matchmaking (Optimized for 50k Surge)
-- KEYS[1]: matchmaking:queue (Sorted Set, score is ELO)
-- KEYS[2]: matchmaking:waitlist (Sorted Set, score is joinedAt timestamp)
-- ARGV[1]: matchmaking:entry: prefix
-- ARGV[2]: current_time (ms)
-- ARGV[3]: elo_range_initial
-- ARGV[4]: elo_range_expansion
-- ARGV[5]: expansion_interval (ms)
-- ARGV[6]: vanguard_priority_ms

local queue_elo_key = KEYS[1]
local queue_time_key = KEYS[2]
local entries_prefix = ARGV[1]
local current_time = tonumber(ARGV[2])
local elo_range_initial = tonumber(ARGV[3])
local elo_range_expansion = tonumber(ARGV[4])
local expansion_interval = tonumber(ARGV[5])
local vanguard_priority_ms = tonumber(ARGV[6])

-- Process only the 100 oldest users in the waitlist per execution to avoid blocking Redis
local batch_users = redis.call('ZRANGE', queue_time_key, 0, 99)
local matches = {}
local matched_users = {}

for _, user_id in ipairs(batch_users) do
    if not matched_users[user_id] then
        local entry_raw = redis.call('HGETALL', entries_prefix .. user_id)
        if #entry_raw > 0 then
            local entry = {}
            for j = 1, #entry_raw, 2 do
                entry[entry_raw[j]] = entry_raw[j+1]
            end
            
            local elo = tonumber(entry['elo'])
            local joined_at = tonumber(entry['joinedAt'])
            local cohort = entry['cohort']
            local time_in_queue = current_time - joined_at
            local expansion_count = math.floor(time_in_queue / expansion_interval)
            local elo_range = elo_range_initial + (elo_range_expansion * expansion_count)
            
            local min_elo = elo - elo_range
            local max_elo = elo + elo_range
            
            -- Use ELO-based indexing with a limit to avoid full-set scans
            local opponents = redis.call('ZRANGEBYSCORE', queue_elo_key, min_elo, max_elo, 'LIMIT', 0, 20)
            
            for _, opp_id in ipairs(opponents) do
                if opp_id ~= user_id and not matched_users[opp_id] then
                    local opp_entry_raw = redis.call('HGETALL', entries_prefix .. opp_id)
                    if #opp_entry_raw > 0 then
                        local opp_entry = {}
                        for k = 1, #opp_entry_raw, 2 do
                            opp_entry[opp_entry_raw[k]] = opp_entry_raw[k+1]
                        end
                        
                        local opp_cohort = opp_entry['cohort']
                        local can_match = true
                        
                        -- Vanguard priority logic
                        if cohort == 'vanguard_500' and time_in_queue < vanguard_priority_ms then
                            if opp_cohort ~= 'vanguard_500' then
                                can_match = false
                            end
                        end
                        
                        -- Check opponent's Vanguard priority too
                        if can_match and opp_cohort == 'vanguard_500' then
                            local opp_joined_at = tonumber(opp_entry['joinedAt'])
                            local opp_time_in_queue = current_time - opp_joined_at
                            if opp_time_in_queue < vanguard_priority_ms then
                                if cohort ~= 'vanguard_500' then
                                    can_match = false
                                end
                            end
                        end
                        
                        if can_match then
                            matched_users[user_id] = true
                            matched_users[opp_id] = true
                            
                            -- Remove from both sorted sets and the entry hash
                            redis.call('ZREM', queue_elo_key, user_id, opp_id)
                            redis.call('ZREM', queue_time_key, user_id, opp_id)
                            redis.call('DEL', entries_prefix .. user_id, entries_prefix .. opp_id)
                            
                            table.insert(matches, user_id)
                            table.insert(matches, opp_id)
                            break
                        end
                    end
                end
            end
        end
    end
end

return matches
