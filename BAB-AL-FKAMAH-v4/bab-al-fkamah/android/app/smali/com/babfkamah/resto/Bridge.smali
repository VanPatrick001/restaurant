.class public Lcom/babfkamah/resto/Bridge;
.super Ljava/lang/Object;
.source "Bridge.java"

.field private final act:Lcom/babfkamah/resto/MainActivity;

.method public constructor <init>(Lcom/babfkamah/resto/MainActivity;)V
    .registers 2
    invoke-direct {p0}, Ljava/lang/Object;-><init>()V
    iput-object p1, p0, Lcom/babfkamah/resto/Bridge;->act:Lcom/babfkamah/resto/MainActivity;
    return-void
.end method

.method public print()V
    .registers 4
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation
    iget-object v0, p0, Lcom/babfkamah/resto/Bridge;->act:Lcom/babfkamah/resto/MainActivity;
    new-instance v1, Lcom/babfkamah/resto/Action;
    const/4 v2, 0x1
    invoke-direct {v1, v0, v2}, Lcom/babfkamah/resto/Action;-><init>(Lcom/babfkamah/resto/MainActivity;I)V
    invoke-virtual {v0, v1}, Lcom/babfkamah/resto/MainActivity;->runOnUiThread(Ljava/lang/Runnable;)V
    return-void
.end method

.method public reglages()V
    .registers 4
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation
    iget-object v0, p0, Lcom/babfkamah/resto/Bridge;->act:Lcom/babfkamah/resto/MainActivity;
    new-instance v1, Lcom/babfkamah/resto/Action;
    const/4 v2, 0x2
    invoke-direct {v1, v0, v2}, Lcom/babfkamah/resto/Action;-><init>(Lcom/babfkamah/resto/MainActivity;I)V
    invoke-virtual {v0, v1}, Lcom/babfkamah/resto/MainActivity;->runOnUiThread(Ljava/lang/Runnable;)V
    return-void
.end method

.method public version()Ljava/lang/String;
    .registers 2
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation
    const-string v0, "1.0"
    return-object v0
.end method
