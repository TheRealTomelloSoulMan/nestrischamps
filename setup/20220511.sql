CREATE OR REPLACE FUNCTION ntc_final_mode(a anyarray)
    RETURNS integer 
    LANGUAGE plpgsql
AS $$
    DECLARE
	-- Return value
        avg_mode INTEGER := 0;
	-- Number of games of modal range
	max_games INTEGER := 0;
	-- Range size
	step INTEGER := 100000;
	-- This * step = lower boundary of modal range
	target_range INTEGER := 0;
    BEGIN
	-- Find out range with max number of games
	SELECT
		INTO target_range, max_games
		floor(score / step) AS score_band, count(score) AS num_games
	FROM 
		unnest(a) score
	GROUP BY score_band
	ORDER BY num_games DESC, score_band DESC
	LIMIT 1;
	-- Return average score in the modal range
	SELECT
		INTO avg_mode
		round(avg(score))::INTEGER
	FROM
		unnest(a) score
	WHERE
		score BETWEEN target_range * step AND target_range * step + step;
	return avg_mode;
    END;
$$;

CREATE AGGREGATE ntc_mode(anyelement) (
  SFUNC=array_append,
  STYPE=anyarray,
  FINALFUNC=ntc_final_mode,
  INITCOND='{}'
);
