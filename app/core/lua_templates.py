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
local set_key = KEYS[1]
local count = tonumber(ARGV[1])
local winning_ticket = ARGV[2]

local tickets = redis.call("SRANDMEMBER", set_key, count)
local winners = 0

for i=1,#tickets do
    if tickets[i] == winning_ticket then
        winners = winners + 1
    end
end
return winners
"""