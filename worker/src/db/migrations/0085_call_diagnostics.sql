-- Video calls: the connection log (ICE / socket state changes, restarts, the route used)
-- each participant reported during the call, copied from the CallRoom with the board.
ALTER TABLE calls ADD COLUMN diagnostics_json TEXT;
