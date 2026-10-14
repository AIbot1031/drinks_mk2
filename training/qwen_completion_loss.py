"""Exact completion-only CE with bounded logits, full untruncated conditioning."""
def completion_loss(model,batch,lengths,*,num_layers=1,window=512):
    import mlx.core as mx
    import mlx.nn as nn
    # Qwen3.5 frozen DeltaNet blocks need no backwards pass. Keep their inference
    # kernels; only the adapter-containing final attention block trains.
    model.eval()
    for layer in model.layers[-num_layers:]:layer.train()
    inputs=batch[:,:-1];targets=batch[:,1:]
    start=max(0,targets.shape[1]-window)
    hidden=model.model(inputs)[:,start:,:]
    text_model=model.language_model
    logits=text_model.model.embed_tokens.as_linear(hidden) if text_model.args.tie_word_embeddings else text_model.lm_head(hidden)
    steps=mx.arange(start+1,targets.shape[1]+1)
    mask=mx.logical_and(steps>=lengths[:,0:1],steps<=lengths[:,1:])
    count=mask.sum()
    loss=(nn.losses.cross_entropy(logits,targets[:,start:])*mask).astype(mx.float32).sum()/count
    return loss,count
