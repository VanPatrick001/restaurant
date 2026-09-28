.class public Lcom/babfkamah/resto/Action;
.super Ljava/lang/Object;
.source "Action.java"

# Execute sur le fil d'interface : 1 = imprimer, 2 = ouvrir les reglages du serveur
.implements Ljava/lang/Runnable;

.field private final act:Lcom/babfkamah/resto/MainActivity;
.field private final type:I

.method public constructor <init>(Lcom/babfkamah/resto/MainActivity;I)V
    .registers 3
    invoke-direct {p0}, Ljava/lang/Object;-><init>()V
    iput-object p1, p0, Lcom/babfkamah/resto/Action;->act:Lcom/babfkamah/resto/MainActivity;
    iput p2, p0, Lcom/babfkamah/resto/Action;->type:I
    return-void
.end method

.method public run()V
    .registers 7
    iget-object v0, p0, Lcom/babfkamah/resto/Action;->act:Lcom/babfkamah/resto/MainActivity;
    iget-object v1, v0, Lcom/babfkamah/resto/MainActivity;->web:Landroid/webkit/WebView;
    if-eqz v1, :fin
    iget v2, p0, Lcom/babfkamah/resto/Action;->type:I
    const/4 v3, 0x1
    if-eq v2, v3, :imprimer

    const-string v2, "file:///android_asset/index.html#reglages"
    invoke-virtual {v1, v2}, Landroid/webkit/WebView;->loadUrl(Ljava/lang/String;)V
    return-void

    :imprimer
    const-string v2, "print"
    invoke-virtual {v0, v2}, Lcom/babfkamah/resto/MainActivity;->getSystemService(Ljava/lang/String;)Ljava/lang/Object;
    move-result-object v2
    check-cast v2, Landroid/print/PrintManager;
    const-string v3, "Resto Manager - Ticket"
    invoke-virtual {v1, v3}, Landroid/webkit/WebView;->createPrintDocumentAdapter(Ljava/lang/String;)Landroid/print/PrintDocumentAdapter;
    move-result-object v4
    new-instance v5, Landroid/print/PrintAttributes$Builder;
    invoke-direct {v5}, Landroid/print/PrintAttributes$Builder;-><init>()V
    invoke-virtual {v5}, Landroid/print/PrintAttributes$Builder;->build()Landroid/print/PrintAttributes;
    move-result-object v5
    invoke-virtual {v2, v3, v4, v5}, Landroid/print/PrintManager;->print(Ljava/lang/String;Landroid/print/PrintDocumentAdapter;Landroid/print/PrintAttributes;)Landroid/print/PrintJob;
    :fin
    return-void
.end method
