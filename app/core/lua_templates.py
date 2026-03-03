# Ticket Generator (Turbo Mode)
LUA_GEN_SCRIPT = """
local count = tonumber(ARGV[1])
for i = 1, count do
    local t = ""
    for j = 1, 8 do
        local n = math.random(0, 99)
        if n < 10 then t = t .. "0" .. n else t = t .. n end
    end
    redis.call("SADD", KEYS[1], t)
end
redis.call("INCRBY", KEYS[2], count)
return count
"""

# Multi-check logic (Atomic on Redis side)
LUA_MULTI_CHECK = """
-- KEYS[1] = tickets set
-- ARGV[1] = count
-- ARGV[2] = winning_ticket
local set_key = KEYS[1]
local count = tonumber(ARGV[1])
local winning = ARGV[2]

local tickets = redis.call("SRANDMEMBER", set_key, count)
local winners = 0

for i=1,#tickets do
  if tickets[i] == winning then
    winners = winners + 1
  end
end

return {winners, #tickets}
"""

LUA_DRAW_SCRIPT = """
-- KEYS[1] = winner key (lottery:winning_number)
-- KEYS[2] = tickets set (lottery:tickets)
local current = redis.call("GET", KEYS[1])
if current and current ~= "" then
  return current
end

local winner = redis.call("SRANDMEMBER", KEYS[2])
if not winner then
  return ""
end

-- set only if not exists (atomic)
local ok = redis.call("SETNX", KEYS[1], winner)
if ok == 1 then
  return winner
end

-- someone else won the race
return redis.call("GET", KEYS[1]) or ""
"""