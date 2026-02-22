import asyncio
import redis.asyncio as redis
import time


async def run_load_test():
    # Establish connection to Redis
    r = redis.Redis(host='localhost', port=6379, decode_responses=True)

    start_time = time.time()
    batch_size = 5000  # Number of commands per pipeline batch
    total_bets = 100000

    print(f"Starting load test: Injecting {total_bets} bets...")

    for i in range(0, total_bets, batch_size):
        # OPEN PIPELINE
        # transaction=False improves performance when atomicity isn't strictly required
        async with r.pipeline(transaction=False) as pipe:
            for j in range(i, i + batch_size):
                ticket_id = f"ticket:{j}"

                # Queue commands (buffered locally, not yet sent to the network)
                pipe.set(ticket_id, "active")
                pipe.incr("stats:total_bets")

            # EXECUTE BATCH
            # Sends all buffered commands in a single network round-trip
            await pipe.execute()

    end_time = time.time()
    duration = end_time - start_time

    print(f"Load test complete!")
    print(f"Total time: {duration:.2f} seconds.")
    print(f"Throughput: {total_bets / duration:.0f} ops/sec")

    await r.close()


if __name__ == "__main__":
    asyncio.run(run_load_test())